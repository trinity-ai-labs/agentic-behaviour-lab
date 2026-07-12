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
 *
 * Three layers of defense against provider degradation contaminating
 * behaviour rates:
 * 1. Disposition gate — only 'completed' subjects reach the grader.
 * 2. Ambient provider-health capture — best-effort statuspage polls.
 * 3. Degraded-run flagging — >20% error share marks the RunRecord.
 */
import { Command, CommandExecutor } from '@effect/platform';
import { Context, Data, Effect, Layer, Schema, Stream } from 'effect';
import { randomUUID } from 'node:crypto';
import * as NodeOs from 'node:os';
import { AdapterRegistry } from './adapter.js';
import type { SubjectDisposition } from './adapter.js';
import { getProviderForHarness, parseModelId } from './catalog.js';
import { TrialIndex, type IndexError } from './index-db.js';
import { KeyStore } from './keys.js';
import { resolveModelEnv } from './provider-routing.js';
import {
  renderBrief,
  ScenarioRepo,
  type LoadedScenario,
  type ScenarioLoadError,
} from './scenarios.js';
import {
  ExecutionShape,
  ProviderStatusSnapshot,
  RunConfig,
  RunRecord,
  TrialRecord,
  Verdict,
} from './schema.js';
import { ArtifactStore, type StoreError } from './store.js';

// ---------------------------------------------------------------------------
// Provider status endpoints (statuspage JSON)
// ---------------------------------------------------------------------------

interface StatusEndpoint {
  readonly provider: string;
  readonly url: string;
}

const STATUS_ENDPOINTS: readonly StatusEndpoint[] = [
  { provider: 'anthropic', url: 'https://status.anthropic.com/api/v2/summary.json' },
  { provider: 'openai', url: 'https://status.openai.com/api/v2/summary.json' },
];

/** Best-effort fetch of a provider's statuspage summary. Short timeout, never blocks. */
const fetchProviderStatus = (
  endpoint: StatusEndpoint,
): Effect.Effect<typeof ProviderStatusSnapshot.Type | undefined> =>
  Effect.tryPromise({
    try: (signal: AbortSignal) =>
      fetch(endpoint.url, { signal }).then(async (response) => {
        const body: unknown = await response.json();
        // statuspage v2 summary.json has a "status" block with "description"
        const status =
          body != null && typeof body === 'object' && 'status' in body
            ? String((body as Record<string, unknown>).status)
            : 'unknown';
        return {
          provider: endpoint.provider,
          status,
          fetchedAt: new Date().toISOString(),
          raw: JSON.stringify(body).slice(0, 1_000),
        };
      }),
    catch: () => undefined,
  }).pipe(
    Effect.timeout('3 seconds'),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

/**
 * Maps a harness id to its likely provider for status lookups.
 * Uses the catalog for known harnesses; falls back to string matching for versioned ids.
 */
const harnessProvider = (harness: string): string | undefined => {
  return getProviderForHarness(harness);
};

/** Fetch provider status for every unique provider among the requested harnesses. */
const captureProviderStatus = (
  harnesses: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<typeof ProviderStatusSnapshot.Type>> => {
  const providers = new Set(harnesses.map((h) => harnessProvider(h)).filter(Boolean));
  if (providers.size === 0) return Effect.succeed([]);
  return Effect.all(
    STATUS_ENDPOINTS.filter((ep) => providers.has(ep.provider)).map(fetchProviderStatus),
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.map((snapshots) =>
      snapshots.filter((s): s is typeof ProviderStatusSnapshot.Type => s !== undefined),
    ),
  );
};

export class RunConfigError extends Data.TaggedError('RunConfigError')<{
  readonly reason: string;
}> {}

class ScriptFailure extends Data.TaggedError('ScriptFailure')<{
  readonly scriptPath: string;
  readonly cause: unknown;
}> {}

export interface RunTrialParams {
  readonly runId: string;
  readonly scenario: LoadedScenario;
  readonly condition: { readonly label: string; readonly params: Readonly<Record<string, string>> };
  readonly modelId: string;
  /** Harness id resolved through `AdapterRegistry` (e.g. "claude-cli", "codex-cli"). */
  readonly harness: string;
  readonly shape: ExecutionShape;
  /** Defaults to a fresh UUID; overridable so callers/tests can pin trial directories. */
  readonly trialId?: string;
}

export type RunTrialError = StoreError | IndexError;
export type RunBatchError = RunTrialError | ScenarioLoadError | RunConfigError;

export interface RunnerShape {
  readonly runTrial: (params: RunTrialParams) => Effect.Effect<TrialRecord, RunTrialError>;
  readonly runBatch: (config: RunConfig) => Effect.Effect<RunRecord, RunBatchError>;
}

export class Runner extends Context.Tag('@abl/engine/Runner')<Runner, RunnerShape>() {}

const nowIso = (): string => new Date().toISOString();
const osFingerprint = (): string => `${process.platform} ${NodeOs.release()}`;
const VerdictFromJson = Schema.parseJson(Verdict);

/** `.sh` runs under bash; everything else (`.mjs`, `.js`) runs under node — no reliance on the executable bit surviving checkout. */
const interpreterFor = (scriptPath: string): readonly [string, ...ReadonlyArray<string>] =>
  scriptPath.endsWith('.sh') ? ['bash', scriptPath] : ['node', scriptPath];

export const RunnerLive: Layer.Layer<
  Runner,
  never,
  ScenarioRepo | ArtifactStore | AdapterRegistry | TrialIndex | KeyStore | CommandExecutor.CommandExecutor
> = Layer.effect(
  Runner,
  Effect.gen(function* () {
    const scenarios = yield* ScenarioRepo;
    const store = yield* ArtifactStore;
    const registry = yield* AdapterRegistry;
    const index = yield* TrialIndex;
    const keys = yield* KeyStore;
    const executor = yield* CommandExecutor.CommandExecutor;

    const runCaptured = (
      command: Command.Command,
    ): Effect.Effect<{ readonly stdout: string; readonly exitCode: number }, unknown> =>
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* executor.start(command);
          // Drain stdout and await the exit code concurrently: a process
          // writing more than the pipe buffer would deadlock if we waited
          // for exit before reading.
          const [stdout, code] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(process.stdout)), process.exitCode],
            { concurrency: 'unbounded' },
          );
          return { stdout, exitCode: Number(code) };
        }),
      );

    /** Runs a fixture/grader script, failing on a nonzero exit — the only way these scripts signal infrastructure trouble. */
    const runScript = (
      scriptPath: string,
      env: Readonly<Record<string, string>>,
      cwd: string,
    ): Effect.Effect<string, ScriptFailure> =>
      Effect.gen(function* () {
        const [bin, ...args] = interpreterFor(scriptPath);
        const command = Command.make(bin, ...args).pipe(
          Command.workingDirectory(cwd),
          Command.env(env),
        );
        const { stdout, exitCode } = yield* runCaptured(command).pipe(
          Effect.mapError((cause) => new ScriptFailure({ scriptPath, cause })),
        );
        if (exitCode !== 0) {
          return yield* Effect.fail(
            new ScriptFailure({
              scriptPath,
              cause: `exited ${exitCode}: ${stdout.slice(0, 2000)}`,
            }),
          );
        }
        return stdout;
      });

    const errorVerdict = (
      cause: unknown,
      disposition?: SubjectDisposition,
      dispositionCause?: string,
    ): Verdict => ({
      outcome: 'error',
      gradedBy: 'mechanical',
      detail: {
        cause: cause instanceof Error ? cause.message : String(cause),
        ...(disposition !== undefined ? { disposition } : {}),
        ...(dispositionCause !== undefined ? { dispositionCause } : {}),
      },
      note: 'trial infrastructure failed before a grader verdict was produced',
    });

    const runTrial: RunnerShape['runTrial'] = (params) =>
      Effect.gen(function* () {
        const trialId = params.trialId ?? randomUUID();
        const startedAt = nowIso();
        const trialDir = store.trialDir(params.runId, trialId);

        // The fingerprint must never lack a harness value (unfingerprinted
        // records are worthless): starts as the requested harness id and is
        // overwritten with the adapter's versioned id the moment the adapter
        // resolves — so even a trial whose subject crashes mid-run records
        // the real executing harness+version.
        let harness = params.harness;

        const outcome = yield* Effect.gen(function* () {
          const workspaceDir = yield* store.makeWorkspace(params.runId, trialId);
          yield* runScript(
            params.scenario.fixturePath,
            { WORKSPACE_DIR: workspaceDir },
            workspaceDir,
          );

          // Resolved inside this same catchAll-guarded block: an unregistered
          // harness is trial infrastructure failing, exactly like a broken
          // fixture or a spawn error, so it becomes an "error" verdict too.
          const adapter = yield* registry.resolve(params.harness);
          harness = yield* adapter.harnessId;

          const brief = renderBrief(params.scenario.briefTemplate, params.condition.params);

          // Resolve provider-routing env vars. Keys are looked up from env
          // vars first, then the encrypted store. Swallowed on failure: a
          // missing key or unknown provider leaves env empty, and the
          // subprocess will fail naturally — the degradation pattern matcher
          // catches provider auth errors downstream.
          const { provider } = parseModelId(params.modelId);
          const env = yield* Effect.gen(function* () {
            const secrets: Record<string, string> = {};
            const key = yield* keys.resolve(provider).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
            if (key !== undefined) {
              const keyName = `${provider.toUpperCase()}_API_KEY`;
              secrets[keyName] = key;
            }
            return resolveModelEnv(params.modelId, secrets).env;
          }).pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));

          const subject = yield* adapter.run({
            modelId: params.modelId,
            brief,
            workspaceDir,
            env,
          });

          // -- Grading gate: only 'completed' dispositions reach the grader. --
          if (subject.disposition !== 'completed') {
            return {
              verdict: errorVerdict(
                `subject disposition: ${subject.disposition}`,
                subject.disposition,
                `subject finished with disposition "${subject.disposition}"`,
              ),
              finalMessage: subject.finalMessage,
            };
          }

          const graderOut = yield* runScript(
            params.scenario.graderPath,
            { WORKSPACE_DIR: workspaceDir, TRIAL_DIR: trialDir },
            workspaceDir,
          );
          const verdict = yield* Schema.decodeUnknown(VerdictFromJson)(graderOut);
          return { verdict, finalMessage: subject.finalMessage };
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.succeed({ verdict: errorVerdict(cause), finalMessage: undefined }),
          ),
        );

        const artifacts: Record<string, string> = {};
        if (outcome.finalMessage !== undefined) {
          yield* store.writeArtifact(
            params.runId,
            trialId,
            'final-message.txt',
            outcome.finalMessage,
          );
          artifacts.finalMessage = 'final-message.txt';
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
        };

        yield* store.writeTrial(record);
        yield* index.insertTrial(record);
        yield* store.removeWorkspace(params.runId, trialId).pipe(Effect.ignore);

        return record;
      });

    const runBatch: RunnerShape['runBatch'] = (config) =>
      Effect.gen(function* () {
        const scenario = yield* scenarios.load(config.scenarioId);

        const byLabel = new Map(
          scenario.definition.conditions.map((condition) => [condition.label, condition]),
        );
        const missing = config.conditions.filter((label) => !byLabel.has(label));
        if (missing.length > 0) {
          return yield* Effect.fail(
            new RunConfigError({
              reason: `unknown condition(s) for scenario "${config.scenarioId}": ${missing.join(', ')} (known: ${[...byLabel.keys()].join(', ')})`,
            }),
          );
        }

        const runId = randomUUID();

        // -- Provider status: captured at run start (pre-trial) and end (post-trial). --
        const startStatus = yield* captureProviderStatus(config.harnesses);
        const running: RunRecord = {
          runId,
          config,
          startedAt: nowIso(),
          status: 'running',
          providerStatus: startStatus.length > 0 ? startStatus : undefined,
        };
        yield* store.writeRun(running);

        const cells = config.conditions.flatMap((label) => {
          // Safe: every label in config.conditions was validated against byLabel above.
          const condition = byLabel.get(label)!;
          return config.models.flatMap((modelId) =>
            config.harnesses.flatMap((harness) =>
              Array.from({ length: config.trialsPerCell }, () => ({ condition, modelId, harness })),
            ),
          );
        });

        const trials = yield* Effect.forEach(
          cells,
          ({ condition, modelId, harness }) =>
            runTrial({ runId, scenario, condition, modelId, harness, shape: config.shape }),
          { concurrency: config.maxConcurrent },
        );

        // -- Validity: if error share > 20%, mark the run as degraded-conditions. --
        const errorCount = trials.filter((t) => t.verdict.outcome === 'error').length;
        const totalTrials = trials.length;
        const validity: 'valid' | 'degraded-conditions' =
          totalTrials > 0 && errorCount / totalTrials > 0.2 ? 'degraded-conditions' : 'valid';

        const endStatus = yield* captureProviderStatus(config.harnesses);
        const combinedStatus =
          startStatus.length > 0 || endStatus.length > 0
            ? [...startStatus, ...endStatus]
            : undefined;

        const completed: RunRecord = {
          ...running,
          status: 'completed',
          endedAt: nowIso(),
          providerStatus: combinedStatus,
          validity,
        };
        yield* store.writeRun(completed);
        yield* index.upsertValidity(runId, validity);
        return completed;
      });

    return Runner.of({ runTrial, runBatch });
  }),
);
