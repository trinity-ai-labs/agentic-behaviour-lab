/**
 * `AgentAdapter` is the seam between the runner and whatever actually plays
 * the subject role in a trial. Three v1 implementations: `ClaudeCliAdapter`
 * spawns the real `claude` CLI headless, `CodexCliAdapter` spawns the real
 * `codex` CLI headless, and `StubAdapter` runs a designated script instead.
 * Every test in this package uses `StubAdapter` — no API spend, fully
 * deterministic, and neither real CLI is ever invoked outside a human
 * running the smoke script or a live batch.
 *
 * A trial names its harness by id (`RunConfig.harnesses` / a plain string
 * such as `"claude-cli"` or `"codex-cli"`); `AdapterRegistry` is the small
 * service that resolves that id to a built adapter, so the runner can pick
 * per trial instead of one adapter being fixed at layer-wiring time.
 */
import { Command, CommandExecutor, FileSystem } from '@effect/platform';
import { Context, Data, Effect, Either, Layer, Schema } from 'effect';

export class AgentRunError extends Data.TaggedError('AgentRunError')<{
  readonly modelId: string;
  readonly cause: unknown;
}> {}

export interface SubjectResult {
  readonly finalMessage: string;
}

export interface AgentAdapterShape {
  /** Identifies the harness that executed the trial, e.g. `"claude-code/2.1.206 (headless -p)"`. */
  readonly harnessId: Effect.Effect<string>;
  readonly run: (params: {
    readonly modelId: string;
    readonly brief: string;
    readonly workspaceDir: string;
  }) => Effect.Effect<SubjectResult, AgentRunError>;
}

export class AgentAdapter extends Context.Tag('@abl/engine/AgentAdapter')<
  AgentAdapter,
  AgentAdapterShape
>() {}

/** Well-known harness ids for the two real CLI adapters; `AdapterRegistry` keys may be any string (tests register their own). */
export const CLAUDE_CLI_HARNESS = 'claude-cli';
export const CODEX_CLI_HARNESS = 'codex-cli';

const CliResultJson = Schema.parseJson(Schema.Struct({ result: Schema.String }));
const decodeCliResult = Schema.decodeUnknownEither(CliResultJson);

/** Best-effort extraction of the `result` field from `claude -p --output-format json`; raw stdout otherwise. */
const extractFinalMessage = (stdout: string): string => {
  const decoded = decodeCliResult(stdout);
  return Either.isRight(decoded) ? decoded.right.result : stdout;
};

/** `<bin> --version`, trimmed; "unknown" when the binary is missing or the probe fails — the fingerprint must still carry something. */
const probeVersion = (
  executor: CommandExecutor.CommandExecutor,
  bin: string,
): Effect.Effect<string> =>
  executor.string(Command.make(bin, '--version')).pipe(
    Effect.map((s) => s.trim()),
    Effect.orElseSucceed(() => 'unknown'),
  );

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
export const ClaudeCliAdapterLive: Layer.Layer<
  AgentAdapter,
  never,
  CommandExecutor.CommandExecutor
> = Layer.effect(
  AgentAdapter,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;

    const version = yield* probeVersion(executor, 'claude');
    const harness = `claude-code/${version} (headless -p)`;

    const run: AgentAdapterShape['run'] = ({ modelId, brief, workspaceDir }) => {
      const command = Command.make(
        'claude',
        '-p',
        brief,
        '--model',
        modelId,
        '--permission-mode',
        'bypassPermissions',
        '--output-format',
        'json',
      ).pipe(Command.workingDirectory(workspaceDir));

      return executor.string(command).pipe(
        Effect.map((stdout): SubjectResult => ({ finalMessage: extractFinalMessage(stdout) })),
        Effect.mapError((cause) => new AgentRunError({ modelId, cause })),
      );
    };

    return AgentAdapter.of({ harnessId: Effect.succeed(harness), run });
  }),
);

/**
 * Spawns `codex exec --model <id> --dangerously-bypass-approvals-and-sandbox
 * --skip-git-repo-check --output-last-message <tmpFile> <brief>` with `cwd`
 * set to the trial workspace. `--dangerously-bypass-approvals-and-sandbox`
 * mirrors Claude's `bypassPermissions` above: skips Codex's own
 * approval/sandbox prompts, which would otherwise hang a headless run — safe
 * for the same reason, the workspace is an ephemeral directory the trial
 * owns exclusively. `--skip-git-repo-check` is required because a trial
 * workspace is a plain directory, not a git repo, and Codex otherwise
 * refuses to run outside one. `--output-last-message <file>` is Codex's
 * documented way to get exactly the agent's final message, so a scoped tmp
 * file is read back (and dropped with the scope, even when the spawn fails)
 * instead of parsing mixed progress/tool-call text out of stdout (verified
 * against `codex exec --help`; no test may invoke this adapter —
 * `StubAdapter` covers every test path).
 */
export const CodexCliAdapterLive: Layer.Layer<
  AgentAdapter,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> = Layer.effect(
  AgentAdapter,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const fs = yield* FileSystem.FileSystem;

    const version = yield* probeVersion(executor, 'codex');
    const harness = `${CODEX_CLI_HARNESS}/${version} (exec)`;

    const run: AgentAdapterShape['run'] = ({ modelId, brief, workspaceDir }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const outputFile = yield* fs.makeTempFileScoped({ prefix: 'abl-codex-' });
          const command = Command.make(
            'codex',
            'exec',
            '--model',
            modelId,
            '--dangerously-bypass-approvals-and-sandbox',
            '--skip-git-repo-check',
            '--output-last-message',
            outputFile,
            brief,
          ).pipe(Command.workingDirectory(workspaceDir));

          yield* executor.string(command);
          const finalMessage = yield* fs.readFileString(outputFile);
          return { finalMessage: finalMessage.trim() } satisfies SubjectResult;
        }),
      ).pipe(Effect.mapError((cause) => new AgentRunError({ modelId, cause })));

    return AgentAdapter.of({ harnessId: Effect.succeed(harness), run });
  }),
);

/**
 * Runs a designated script instead of a real agent. `scripts` maps a
 * modelId to the absolute path of the script to execute; the script
 * receives `WORKSPACE_DIR` and `BRIEF` as env (cwd is also the workspace)
 * and its stdout becomes the subject's final message. `harnessId` defaults
 * to a fixed string; tests that need two distinguishable stub harnesses in
 * one registry (see `AdapterRegistryLive` below) override it per instance.
 */
export const StubAdapterLive = (
  scripts: Readonly<Record<string, string>>,
  harnessId = 'stub-adapter/1',
): Layer.Layer<AgentAdapter, never, CommandExecutor.CommandExecutor> =>
  Layer.effect(
    AgentAdapter,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor;

      const run: AgentAdapterShape['run'] = ({ modelId, brief, workspaceDir }) => {
        const scriptPath = scripts[modelId];
        if (scriptPath === undefined) {
          return Effect.fail(
            new AgentRunError({
              modelId,
              cause: `no stub script registered for model "${modelId}"`,
            }),
          );
        }
        const command = Command.make('node', scriptPath).pipe(
          Command.workingDirectory(workspaceDir),
          Command.env({ WORKSPACE_DIR: workspaceDir, BRIEF: brief }),
        );
        return executor.string(command).pipe(
          Effect.map((stdout): SubjectResult => ({ finalMessage: stdout.trim() })),
          Effect.mapError((cause) => new AgentRunError({ modelId, cause })),
        );
      };

      return AgentAdapter.of({ harnessId: Effect.succeed(harnessId), run });
    }),
  );

// ---------------------------------------------------------------------------
// AdapterRegistry — resolves a harness id to its built adapter, per trial.
//
// Adapter selection used to happen once at layer-wiring time (whichever
// single AgentAdapter a caller provided). Comparing harnesses within one run
// means the runner instead picks per trial from `RunTrialParams.harness`, so
// every harness a run might request has to be registered up front.
// ---------------------------------------------------------------------------

export class UnknownHarnessError extends Data.TaggedError('UnknownHarnessError')<{
  readonly harness: string;
  readonly known: ReadonlyArray<string>;
}> {}

export interface AdapterRegistryShape {
  /** Looks up the adapter registered for a harness id (e.g. `"claude-cli"`, `"codex-cli"`, or a test's own stub id). */
  readonly resolve: (harness: string) => Effect.Effect<AgentAdapterShape, UnknownHarnessError>;
}

export class AdapterRegistry extends Context.Tag('@abl/engine/AdapterRegistry')<
  AdapterRegistry,
  AdapterRegistryShape
>() {}

/** Harness id -> the adapter layer that serves it. Passed to `AdapterRegistryLive` and `EngineConfig.adapters`. */
export type AdapterMap = Readonly<
  Record<
    string,
    Layer.Layer<AgentAdapter, never, CommandExecutor.CommandExecutor | FileSystem.FileSystem>
  >
>;

/** Both real CLI adapters under their well-known ids — what production entrypoints register. */
export const cliAdapters: AdapterMap = {
  [CLAUDE_CLI_HARNESS]: ClaudeCliAdapterLive,
  [CODEX_CLI_HARNESS]: CodexCliAdapterLive,
};

/**
 * Builds every registered adapter once at construction time — each entry's
 * own `Layer.effect` runs its version probe here (concurrently across
 * adapters, so N probes cost one), exactly as it would if provided
 * directly — then serves harness -> adapter lookups from an in-memory map
 * for the lifetime of the registry.
 */
export const AdapterRegistryLive = (
  adapters: AdapterMap,
): Layer.Layer<AdapterRegistry, never, CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Layer.effect(
    AdapterRegistry,
    Effect.gen(function* () {
      const built = yield* Effect.forEach(
        Object.entries(adapters),
        ([harness, adapterLayer]) =>
          AgentAdapter.pipe(
            Effect.provide(adapterLayer),
            Effect.map((adapter) => [harness, adapter] as const),
          ),
        { concurrency: 'unbounded' },
      );
      const resolved = new Map(built);

      const resolve: AdapterRegistryShape['resolve'] = (harness) => {
        const adapter = resolved.get(harness);
        return adapter === undefined
          ? Effect.fail(new UnknownHarnessError({ harness, known: [...resolved.keys()] }))
          : Effect.succeed(adapter);
      };

      return AdapterRegistry.of({ resolve });
    }),
  );
