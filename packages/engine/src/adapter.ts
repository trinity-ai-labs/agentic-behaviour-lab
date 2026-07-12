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
import { Context, Data, Effect, Either, Layer, Schema, Stream } from 'effect';
import { SubjectDisposition } from './schema.js';
export type { SubjectDisposition } from './schema.js';

export class AgentRunError extends Data.TaggedError('AgentRunError')<{
  readonly modelId: string;
  readonly cause: unknown;
}> {}

export interface SubjectResult {
  readonly finalMessage: string;
  readonly disposition: SubjectDisposition;
}

export interface AgentAdapterShape {
  /** Identifies the harness that executed the trial, e.g. `"claude-code/2.1.206 (headless -p)"`. */
  readonly harnessId: Effect.Effect<string>;
  readonly run: (params: {
    readonly modelId: string;
    readonly brief: string;
    readonly workspaceDir: string;
    /** Extra env vars to inject for provider routing — merged into the subprocess env. */
    readonly env?: Record<string, string>;
  }) => Effect.Effect<SubjectResult, AgentRunError>;
}

export class AgentAdapter extends Context.Tag('@abl/engine/AgentAdapter')<
  AgentAdapter,
  AgentAdapterShape
>() {}

// ---------------------------------------------------------------------------
// Env isolation — strip model-resolver-owned vars from inherited env
// so a host-level value (e.g. ANTHROPIC_BASE_URL from the user's shell
// DeepSeek config) doesn't bleed into a trial with a different provider.
// Only the resolver and harness set these; everything else inherits.
// ---------------------------------------------------------------------------

/** Env vars the model resolver or harness owns — must never be inherited from the host. */
const MODEL_OWNED_VARS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_EFFORT_LEVEL',
] as const;

/**
 * Build an env baseline that strips model-owned vars from the host, then
 * merges the provider-routing `extra` on top. Used by both CLI adapters so
 * only the resolver controls these vars.
 */
const harnessEnv = (extra?: Record<string, string>): Record<string, string> => {
  const stripped: Record<string, string> = {};
  for (const v of MODEL_OWNED_VARS) {
    stripped[v] = '';
  }
  return { ...stripped, ...extra };
};

// ---------------------------------------------------------------------------
// Provider degradation pattern tables
//
// Each entry maps an observable signal (exit code, stderr substring) to a
// disposition reason. Checked after the process finishes; the first match
// wins. Plain data, easily extended per adapter.
// ---------------------------------------------------------------------------

interface DegradationPattern {
  readonly pattern: RegExp;
  readonly reason: string;
  readonly provider: string;
}

const RATE_LIMIT_PATTERNS: readonly DegradationPattern[] = [
  { pattern: /rate_limit/i, reason: 'rate-limited by provider', provider: 'anthropic' },
  { pattern: /rate_limit/i, reason: 'rate-limited by provider', provider: 'openai' },
  { pattern: /429/i, reason: 'HTTP 429 rate-limited by provider', provider: 'anthropic' },
  { pattern: /429/i, reason: 'HTTP 429 rate-limited by provider', provider: 'openai' },
  { pattern: /overloaded_error/i, reason: 'overloaded error from provider', provider: 'anthropic' },
];

const OVERLOAD_PATTERNS: readonly DegradationPattern[] = [
  { pattern: /529/i, reason: 'HTTP 529 overloaded', provider: 'anthropic' },
  { pattern: /529/i, reason: 'HTTP 529 overloaded', provider: 'openai' },
  { pattern: /overloaded/i, reason: 'provider overloaded', provider: 'anthropic' },
  { pattern: /overloaded/i, reason: 'provider overloaded', provider: 'openai' },
  { pattern: /service_unavailable/i, reason: 'service unavailable', provider: 'anthropic' },
  { pattern: /service_unavailable/i, reason: 'service unavailable', provider: 'openai' },
  { pattern: /internal_server_error/i, reason: 'provider internal error', provider: 'anthropic' },
  { pattern: /internal_server_error/i, reason: 'provider internal error', provider: 'openai' },
];

const STREAM_STALL_PATTERNS: readonly DegradationPattern[] = [
  { pattern: /stream watchdog/i, reason: 'stream stall — watchdog fired', provider: 'anthropic' },
  { pattern: /stream watchdog/i, reason: 'stream stall — watchdog fired', provider: 'openai' },
  {
    pattern: /connection reset/i,
    reason: 'stream stall — connection reset',
    provider: 'anthropic',
  },
  { pattern: /connection reset/i, reason: 'stream stall — connection reset', provider: 'openai' },
  {
    pattern: /max retries exceeded/i,
    reason: 'stream stall — max retries exceeded',
    provider: 'anthropic',
  },
  {
    pattern: /max retries exceeded/i,
    reason: 'stream stall — max retries exceeded',
    provider: 'openai',
  },
];

const ALL_DEGRADATION_PATTERNS: readonly DegradationPattern[] = [
  ...RATE_LIMIT_PATTERNS,
  ...OVERLOAD_PATTERNS,
  ...STREAM_STALL_PATTERNS,
];

/** Check stderr against all degradation patterns. Returns the first match, if any. */
const matchDegradation = (stderr: string): DegradationPattern | undefined =>
  ALL_DEGRADATION_PATTERNS.find((p) => p.pattern.test(stderr));

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

/**
 * Captures stdout, stderr, and exit code from a command process. Used by
 * adapter `run` implementations so they can detect provider degradation
 * patterns in stderr and set the disposition accordingly.
 */
const runWithDetails = (executor: CommandExecutor.CommandExecutor, command: Command.Command) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* executor.start(command);
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(process.stdout)),
          Stream.mkString(Stream.decodeText(process.stderr)),
          process.exitCode,
        ],
        { concurrency: 'unbounded' },
      );
      return { stdout, stderr, exitCode: Number(exitCode) };
    }),
  );

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

    const run: AgentAdapterShape['run'] = ({ modelId, brief, workspaceDir, env }) => {
      let command = Command.make(
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

      // Strip model-owned vars from the host env, then merge provider-routing
      // vars on top — only the resolver controls these.
      command = command.pipe(Command.env(harnessEnv(env)));

      return runWithDetails(executor, command).pipe(
        Effect.map(({ stdout, stderr, exitCode }) => {
          const finalMessage = extractFinalMessage(stdout);

          // Check for provider degradation patterns in stderr first.
          const degradation = matchDegradation(stderr);
          if (degradation !== undefined) {
            return { finalMessage, disposition: 'provider-degraded' as const };
          }

          // Non-zero exit without degradation signal means the agent crashed.
          if (exitCode !== 0) {
            return { finalMessage, disposition: 'crashed' as const };
          }

          return { finalMessage, disposition: 'completed' as const };
        }),
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

    const run: AgentAdapterShape['run'] = ({ modelId, brief, workspaceDir, env }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const outputFile = yield* fs.makeTempFileScoped({ prefix: 'abl-codex-' });
          let command = Command.make(
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

          // Strip model-owned vars from the host env, then merge
          // provider-routing vars on top.
          command = command.pipe(Command.env(harnessEnv(env)));

          const { stderr, exitCode } = yield* runWithDetails(executor, command);
          const finalMessage = (yield* fs.readFileString(outputFile)).trim();

          const degradation = matchDegradation(stderr);
          if (degradation !== undefined) {
            return { finalMessage, disposition: 'provider-degraded' as const };
          }
          if (exitCode !== 0) {
            return { finalMessage, disposition: 'crashed' as const };
          }
          return { finalMessage, disposition: 'completed' as const };
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
        return runWithDetails(executor, command).pipe(
          Effect.map(({ stdout, exitCode }): SubjectResult => {
            // If the script emits a DISPOSITION:<value> line, honour it;
            // otherwise derive from exit code.
            const lines = stdout.split('\n');
            const dispLine = lines.find((l) => l.startsWith('DISPOSITION:'));
            const finalMessage = lines
              .filter((l) => !l.startsWith('DISPOSITION:'))
              .join('\n')
              .trim();

            if (dispLine) {
              const value = dispLine.slice('DISPOSITION:'.length).trim();
              // Only accept valid disposition values; if unknown, fall back to completed.
              const disposition: SubjectDisposition = (
                ['completed', 'crashed', 'timeout', 'provider-degraded'] as const
              ).includes(value as SubjectDisposition)
                ? (value as SubjectDisposition)
                : 'completed';
              return { finalMessage, disposition };
            }

            return {
              finalMessage,
              disposition: (exitCode === 0 ? 'completed' : 'crashed') as SubjectDisposition,
            };
          }),
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
