/**
 * `AgentAdapter` is the seam between the runner and whatever actually plays
 * the subject role in a trial. Two v1 implementations: `ClaudeCliAdapter`
 * spawns the real `claude` CLI headless; `StubAdapter` runs a designated
 * script instead. Every test in this package uses `StubAdapter` — no API
 * spend, fully deterministic, and the real CLI is never invoked outside a
 * human running the smoke script or a live batch.
 */
import { Command, CommandExecutor } from "@effect/platform"
import { Context, Data, Effect, Either, Layer, Schema } from "effect"

export class AgentRunError extends Data.TaggedError("AgentRunError")<{
  readonly modelId: string
  readonly cause: unknown
}> {}

export interface SubjectResult {
  readonly finalMessage: string
}

export interface AgentAdapterShape {
  /** Identifies the harness that executed the trial, e.g. `"claude-code/2.1.206 (headless -p)"`. */
  readonly harnessId: Effect.Effect<string>
  readonly run: (params: {
    readonly modelId: string
    readonly brief: string
    readonly workspaceDir: string
  }) => Effect.Effect<SubjectResult, AgentRunError>
}

export class AgentAdapter extends Context.Tag("@abl/engine/AgentAdapter")<AgentAdapter, AgentAdapterShape>() {}

const CliResultJson = Schema.parseJson(Schema.Struct({ result: Schema.String }))
const decodeCliResult = Schema.decodeUnknownEither(CliResultJson)

/** Best-effort extraction of the `result` field from `claude -p --output-format json`; raw stdout otherwise. */
const extractFinalMessage = (stdout: string): string => {
  const decoded = decodeCliResult(stdout)
  return Either.isRight(decoded) ? decoded.right.result : stdout
}

/**
 * Spawns `claude -p <brief> --model <id> --permission-mode bypassPermissions
 * --output-format json` with `cwd` set to the trial workspace.
 * `bypassPermissions` skips interactive tool-approval prompts, which would
 * otherwise hang a headless run — safe here because the workspace is an
 * ephemeral directory the trial owns exclusively and nothing outside it is
 * reachable through the brief. `--output-format json` wraps the response so
 * the final message can be read from the `result` field without depending
 * on freeform stdout formatting (verified against `claude --help`; no test
 * may invoke this adapter — `StubAdapter` covers every test path).
 */
export const ClaudeCliAdapterLive: Layer.Layer<AgentAdapter, never, CommandExecutor.CommandExecutor> = Layer.effect(
  AgentAdapter,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor

    const version = yield* executor.string(Command.make("claude", "--version")).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => "unknown"),
    )
    const harness = `claude-code/${version} (headless -p)`

    const run: AgentAdapterShape["run"] = ({ modelId, brief, workspaceDir }) => {
      const command = Command.make(
        "claude",
        "-p",
        brief,
        "--model",
        modelId,
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "json",
      ).pipe(Command.workingDirectory(workspaceDir))

      return executor.string(command).pipe(
        Effect.map((stdout): SubjectResult => ({ finalMessage: extractFinalMessage(stdout) })),
        Effect.mapError((cause) => new AgentRunError({ modelId, cause })),
      )
    }

    return AgentAdapter.of({ harnessId: Effect.succeed(harness), run })
  }),
)

/**
 * Runs a designated script instead of a real agent. `scripts` maps a
 * modelId to the absolute path of the script to execute; the script
 * receives `WORKSPACE_DIR` and `BRIEF` as env (cwd is also the workspace)
 * and its stdout becomes the subject's final message.
 */
export const StubAdapterLive = (
  scripts: Readonly<Record<string, string>>,
): Layer.Layer<AgentAdapter, never, CommandExecutor.CommandExecutor> =>
  Layer.effect(
    AgentAdapter,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor

      const run: AgentAdapterShape["run"] = ({ modelId, brief, workspaceDir }) => {
        const scriptPath = scripts[modelId]
        if (scriptPath === undefined) {
          return Effect.fail(
            new AgentRunError({ modelId, cause: `no stub script registered for model "${modelId}"` }),
          )
        }
        const command = Command.make("node", scriptPath).pipe(
          Command.workingDirectory(workspaceDir),
          Command.env({ WORKSPACE_DIR: workspaceDir, BRIEF: brief }),
        )
        return executor.string(command).pipe(
          Effect.map((stdout): SubjectResult => ({ finalMessage: stdout.trim() })),
          Effect.mapError((cause) => new AgentRunError({ modelId, cause })),
        )
      }

      return AgentAdapter.of({ harnessId: Effect.succeed("stub-adapter/1"), run })
    }),
  )
