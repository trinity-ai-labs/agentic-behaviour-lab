/**
 * `Runner` drives one trial (workspace → fixture → subject → grader →
 * `trial.json`) and one batch (a `RunConfig` fanned across conditions ×
 * models × harnesses × trials-per-cell). A trial's own error channel is `never` by
 * design: any stage failure — a broken fixture, a subject spawn error, a
 * grader crash, malformed verdict JSON — is caught and turned into an
 * `outcome: "error"` verdict, because "the harness broke" is itself
 * evidence worth recording, not a reason to lose the trial. Only a failure
 * to *persist* the resulting record (disk, index) is a real `Runner`
 * failure, since that means the store itself can no longer be trusted.
 */
import { Command, CommandExecutor } from "@effect/platform"
import { Context, Data, Effect, Layer, Schema, Stream } from "effect"
import { randomUUID } from "node:crypto"
import * as NodeOs from "node:os"
import { AdapterRegistry } from "./adapter.js"
import { TrialIndex, type IndexError } from "./index-db.js"
import { renderBrief, ScenarioRepo, type LoadedScenario, type ScenarioLoadError } from "./scenarios.js"
import { ExecutionShape, RunConfig, RunRecord, TrialRecord, Verdict } from "./schema.js"
import { ArtifactStore, type StoreError } from "./store.js"

export class RunConfigError extends Data.TaggedError("RunConfigError")<{
  readonly reason: string
}> {}

class ScriptFailure extends Data.TaggedError("ScriptFailure")<{
  readonly scriptPath: string
  readonly cause: unknown
}> {}

export interface RunTrialParams {
  readonly runId: string
  readonly scenario: LoadedScenario
  readonly condition: { readonly label: string; readonly params: Readonly<Record<string, string>> }
  readonly modelId: string
  /** Harness id resolved through `AdapterRegistry` (e.g. "claude-cli", "codex-cli"). */
  readonly harness: string
  readonly shape: ExecutionShape
  /** Defaults to a fresh UUID; overridable so callers/tests can pin trial directories. */
  readonly trialId?: string
}

export type RunTrialError = StoreError | IndexError
export type RunBatchError = RunTrialError | ScenarioLoadError | RunConfigError

export interface RunnerShape {
  readonly runTrial: (params: RunTrialParams) => Effect.Effect<TrialRecord, RunTrialError>
  readonly runBatch: (config: RunConfig) => Effect.Effect<RunRecord, RunBatchError>
}

export class Runner extends Context.Tag("@abl/engine/Runner")<Runner, RunnerShape>() {}

const nowIso = (): string => new Date().toISOString()
const osFingerprint = (): string => `${process.platform} ${NodeOs.release()}`
const VerdictFromJson = Schema.parseJson(Verdict)

/** `.sh` runs under bash; everything else (`.mjs`, `.js`) runs under node — no reliance on the executable bit surviving checkout. */
const interpreterFor = (scriptPath: string): readonly [string, ...ReadonlyArray<string>] =>
  scriptPath.endsWith(".sh") ? ["bash", scriptPath] : ["node", scriptPath]

export const RunnerLive: Layer.Layer<
  Runner,
  never,
  ScenarioRepo | ArtifactStore | AdapterRegistry | TrialIndex | CommandExecutor.CommandExecutor
> = Layer.effect(
  Runner,
  Effect.gen(function* () {
    const scenarios = yield* ScenarioRepo
    const store = yield* ArtifactStore
    const registry = yield* AdapterRegistry
    const index = yield* TrialIndex
    const executor = yield* CommandExecutor.CommandExecutor

    const runCaptured = (
      command: Command.Command,
    ): Effect.Effect<{ readonly stdout: string; readonly exitCode: number }, unknown> =>
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* executor.start(command)
          // Drain stdout and await the exit code concurrently: a process
          // writing more than the pipe buffer would deadlock if we waited
          // for exit before reading.
          const [stdout, code] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(process.stdout)), process.exitCode],
            { concurrency: "unbounded" },
          )
          return { stdout, exitCode: Number(code) }
        }),
      )

    /** Runs a fixture/grader script, failing on a nonzero exit — the only way these scripts signal infrastructure trouble. */
    const runScript = (
      scriptPath: string,
      env: Readonly<Record<string, string>>,
      cwd: string,
    ): Effect.Effect<string, ScriptFailure> =>
      Effect.gen(function* () {
        const [bin, ...args] = interpreterFor(scriptPath)
        const command = Command.make(bin, ...args).pipe(Command.workingDirectory(cwd), Command.env(env))
        const { stdout, exitCode } = yield* runCaptured(command).pipe(
          Effect.mapError((cause) => new ScriptFailure({ scriptPath, cause })),
        )
        if (exitCode !== 0) {
          return yield* Effect.fail(
            new ScriptFailure({ scriptPath, cause: `exited ${exitCode}: ${stdout.slice(0, 2000)}` }),
          )
        }
        return stdout
      })

    const errorVerdict = (cause: unknown): Verdict => ({
      outcome: "error",
      gradedBy: "mechanical",
      detail: { cause: cause instanceof Error ? cause.message : String(cause) },
      note: "trial infrastructure failed before a grader verdict was produced",
    })

    const runTrial: RunnerShape["runTrial"] = (params) =>
      Effect.gen(function* () {
        const trialId = params.trialId ?? randomUUID()
        const startedAt = nowIso()
        const trialDir = store.trialDir(params.runId, trialId)

        // The fingerprint must never lack a harness value (unfingerprinted
        // records are worthless): starts as the requested harness id and is
        // overwritten with the adapter's versioned id the moment the adapter
        // resolves — so even a trial whose subject crashes mid-run records
        // the real executing harness+version.
        let harness = params.harness

        const outcome = yield* Effect.gen(function* () {
          const workspaceDir = yield* store.makeWorkspace(params.runId, trialId)
          yield* runScript(params.scenario.fixturePath, { WORKSPACE_DIR: workspaceDir }, workspaceDir)

          // Resolved inside this same catchAll-guarded block: an unregistered
          // harness is trial infrastructure failing, exactly like a broken
          // fixture or a spawn error, so it becomes an "error" verdict too.
          const adapter = yield* registry.resolve(params.harness)
          harness = yield* adapter.harnessId

          const brief = renderBrief(params.scenario.briefTemplate, params.condition.params)
          const subject = yield* adapter.run({ modelId: params.modelId, brief, workspaceDir })

          const graderOut = yield* runScript(
            params.scenario.graderPath,
            { WORKSPACE_DIR: workspaceDir, TRIAL_DIR: trialDir },
            workspaceDir,
          )
          const verdict = yield* Schema.decodeUnknown(VerdictFromJson)(graderOut)
          return { verdict, finalMessage: subject.finalMessage }
        }).pipe(Effect.catchAll((cause) => Effect.succeed({ verdict: errorVerdict(cause), finalMessage: undefined })))

        const artifacts: Record<string, string> = {}
        if (outcome.finalMessage !== undefined) {
          yield* store.writeArtifact(params.runId, trialId, "final-message.txt", outcome.finalMessage)
          artifacts.finalMessage = "final-message.txt"
        }

        const record: TrialRecord = {
          trialId,
          runId: params.runId,
          scenarioId: params.scenario.definition.scenarioId,
          condition: params.condition,
          shape: params.shape,
          fingerprint: {
            modelId: params.modelId,
            harness,
            os: osFingerprint(),
            scenarioVersion: params.scenario.scenarioVersion,
            graderVersion: params.scenario.graderVersion,
          },
          startedAt,
          endedAt: nowIso(),
          artifacts,
          verdict: outcome.verdict,
        }

        yield* store.writeTrial(record)
        yield* index.insertTrial(record)
        yield* store.removeWorkspace(params.runId, trialId).pipe(Effect.ignore)

        return record
      })

    const runBatch: RunnerShape["runBatch"] = (config) =>
      Effect.gen(function* () {
        const scenario = yield* scenarios.load(config.scenarioId)

        const byLabel = new Map(scenario.definition.conditions.map((condition) => [condition.label, condition]))
        const missing = config.conditions.filter((label) => !byLabel.has(label))
        if (missing.length > 0) {
          return yield* Effect.fail(
            new RunConfigError({
              reason: `unknown condition(s) for scenario "${config.scenarioId}": ${missing.join(", ")} (known: ${[...byLabel.keys()].join(", ")})`,
            }),
          )
        }

        const runId = randomUUID()
        const running: RunRecord = { runId, config, startedAt: nowIso(), status: "running" }
        yield* store.writeRun(running)

        const cells = config.conditions.flatMap((label) => {
          // Safe: every label in config.conditions was validated against byLabel above.
          const condition = byLabel.get(label)!
          return config.models.flatMap((modelId) =>
            config.harnesses.flatMap((harness) =>
              Array.from({ length: config.trialsPerCell }, () => ({ condition, modelId, harness })),
            ),
          )
        })

        yield* Effect.forEach(
          cells,
          ({ condition, modelId, harness }) =>
            runTrial({ runId, scenario, condition, modelId, harness, shape: config.shape }),
          { concurrency: config.maxConcurrent, discard: true },
        )

        const completed: RunRecord = { ...running, status: "completed", endedAt: nowIso() }
        yield* store.writeRun(completed)
        return completed
      })

    return Runner.of({ runTrial, runBatch })
  }),
)
