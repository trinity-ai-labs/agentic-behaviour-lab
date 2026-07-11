/**
 * The "describe it -> runnable experiment" loop: `POST /api/author` drafts a
 * scenario directory from a natural-language description by shelling a
 * headless `claude -p` call with the authoring system prompt
 * (`prompts/scenario-author.md`), and `POST /api/scenarios/save` writes a
 * reviewed draft into the local workspace scenarios root
 * (`$ABL_HOME/scenarios/<scenarioId>/`).
 *
 * `AuthorAgent` is the seam over the CLI call, mirroring the engine's
 * `AgentAdapter`/`StubAdapterLive` split: `AuthorAgentLive` spawns the real
 * `claude` binary, `AuthorAgentStubLive` runs a designated script so tests
 * exercise the exact same parsing path without spawning a real agent.
 */
import { Command, CommandExecutor, FileSystem, HttpApiBuilder, Path } from '@effect/platform';
import { defaultAblHome, ScenarioRepo } from '@abl/engine';
import { Config, Context, Data, Effect, Either, Layer, Schema } from 'effect';
import * as NodeOs from 'node:os';
import * as NodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AblApi,
  AuthorFailed,
  AuthorResponse,
  ScenarioSaveInvalid,
  ScenarioSavePathRejected,
  type AuthoredFile,
  type AuthorRequest,
  type SaveScenarioRequest,
} from './api.js';

/** `packages/server/{src,dist}` at either dev (vitest over `src`) or build (`tsc` output in `dist`) time — the prompt file is a sibling of both. */
const moduleDir = NodePath.dirname(fileURLToPath(import.meta.url));
const defaultPromptPath = NodePath.resolve(moduleDir, '../prompts/scenario-author.md');

export class AuthorRunError extends Data.TaggedError('AuthorRunError')<{
  readonly cause: unknown;
}> {}
export class AuthorParseError extends Data.TaggedError('AuthorParseError')<{
  readonly raw: string;
  readonly cause: unknown;
}> {}

export interface AuthorAgentShape {
  /** Raw stdout of the authoring CLI call — `parseAuthorOutput` turns this into an `AuthorResponse`. */
  readonly draft: (params: {
    readonly description: string;
    readonly notes: string | undefined;
  }) => Effect.Effect<string, AuthorRunError>;
}

export class AuthorAgent extends Context.Tag('@abl/server/AuthorAgent')<
  AuthorAgent,
  AuthorAgentShape
>() {}

const DEFAULT_AUTHOR_MODEL = 'claude-sonnet-5';

const userMessage = (description: string, notes: string | undefined): string =>
  notes !== undefined && notes.length > 0
    ? `${description}\n\nAdditional notes: ${notes}`
    : description;

/** Shared tail of both agent implementations: capture the command's stdout, wrapping spawn/exit failures. */
const commandStdout = (
  executor: CommandExecutor.CommandExecutor,
  command: Command.Command,
): Effect.Effect<string, AuthorRunError> =>
  executor.string(command).pipe(Effect.mapError((cause) => new AuthorRunError({ cause })));

/**
 * Spawns `claude -p <description> --model <id> --system-prompt <prompt>
 * --tools "" --output-format json`. `--tools ""` disables every built-in
 * tool: authoring is pure text generation (the draft is JSON in the
 * response, not files written by the model), so the call needs no file or
 * shell access at all. `cwd` is the OS temp directory rather than the
 * server's own checkout or any scenario workspace, so the call is
 * cwd-neutral regardless of what CLAUDE.md/project discovery would
 * otherwise pick up from an inherited `cwd` — moot with tools disabled, but
 * cheap insurance against a future flag re-enabling them.
 */
export const AuthorAgentLive: Layer.Layer<
  AuthorAgent,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> = Layer.effect(
  AuthorAgent,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    // Both die on failure rather than carry a typed error: a missing/corrupt
    // config provider or a missing prompt file (shipped with the package)
    // means the install itself is broken, not something a caller can act on.
    const model = yield* Config.string('ABL_AUTHOR_MODEL').pipe(
      Config.withDefault(DEFAULT_AUTHOR_MODEL),
      Effect.orDie,
    );
    const systemPrompt = yield* fs.readFileString(defaultPromptPath).pipe(Effect.orDie);

    const draft: AuthorAgentShape['draft'] = ({ description, notes }) => {
      const command = Command.make(
        'claude',
        '-p',
        userMessage(description, notes),
        '--model',
        model,
        '--system-prompt',
        systemPrompt,
        '--tools',
        '',
        '--output-format',
        'json',
      ).pipe(Command.workingDirectory(NodeOs.tmpdir()));
      return commandStdout(executor, command);
    };

    return AuthorAgent.of({ draft });
  }),
);

/**
 * Runs a designated script instead of the real CLI — mirrors the engine's
 * `StubAdapterLive`. The script receives `DESCRIPTION`/`NOTES` as env and
 * its stdout stands in for the CLI's raw output, so it should print
 * `claude --output-format json`-shaped text (`{"result": "..."}`) to
 * exercise the same `parseAuthorOutput` path a real call would.
 */
export const AuthorAgentStubLive = (
  scriptPath: string,
): Layer.Layer<AuthorAgent, never, CommandExecutor.CommandExecutor> =>
  Layer.effect(
    AuthorAgent,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor;

      const draft: AuthorAgentShape['draft'] = ({ description, notes }) => {
        const command = Command.make('node', scriptPath).pipe(
          Command.env({ DESCRIPTION: description, NOTES: notes ?? '' }),
        );
        return commandStdout(executor, command);
      };

      return AuthorAgent.of({ draft });
    }),
  );

// ---------------------------------------------------------------------------
// Parsing — the CLI's stdout is untrusted: it's `--output-format json`'s
// `{"result": "..."}` envelope wrapping the model's own text, which itself
// must decode as `AuthorResponse` (optionally markdown-code-fenced).
// ---------------------------------------------------------------------------

const CliOutputJson = Schema.parseJson(Schema.Struct({ result: Schema.String }));
const decodeCliOutput = Schema.decodeUnknownEither(CliOutputJson);
const decodeAuthorResponse = Schema.decodeUnknownEither(Schema.parseJson(AuthorResponse));

/** Strips a single surrounding ```/```json fence, if the whole response is wrapped in one. */
const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
};

export const parseAuthorOutput = (
  stdout: string,
): Effect.Effect<AuthorResponse, AuthorParseError> => {
  const outer = decodeCliOutput(stdout);
  const resultText = Either.isRight(outer) ? outer.right.result : stdout;
  const decoded = decodeAuthorResponse(stripCodeFence(resultText));
  return Either.match(decoded, {
    onLeft: (cause) => Effect.fail(new AuthorParseError({ raw: stdout, cause })),
    onRight: (draft) => Effect.succeed(draft),
  });
};

const tail = (text: string, n: number): string =>
  text.length <= n ? text : text.slice(text.length - n);
const AUTHOR_STDOUT_TAIL = 4000;

// ---------------------------------------------------------------------------
// Save — path-sanitized write into `<ablHome>/scenarios/<scenarioId>/`,
// validated by loading it back through `ScenarioRepo` before reporting
// success.
// ---------------------------------------------------------------------------

const isPlainSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== '.' &&
  segment !== '..' &&
  !segment.includes('/') &&
  !segment.includes('\\');

const decodeErrorReason = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * `HttpApiBuilder.group` for the `authoring` group of `AblApi`. `ablHome`
 * defaults to `$ABL_HOME` (mirrors `ArtifactStoreLive`'s default) and its
 * `scenarios` subdirectory is where drafts are saved — the same local
 * workspace root `ScenarioRepo` is configured with in production
 * (`packages/server/src/main.ts`), so a save is immediately loadable.
 * `authorAgent` defaults to the real CLI so `main.ts` needs no extra wiring;
 * tests override it with `AuthorAgentStubLive`.
 */
export const AuthoringLive = (
  ablHome: string = defaultAblHome(),
  authorAgent: Layer.Layer<
    AuthorAgent,
    never,
    CommandExecutor.CommandExecutor | FileSystem.FileSystem
  > = AuthorAgentLive,
) =>
  HttpApiBuilder.group(AblApi, 'authoring', (handlers) =>
    Effect.gen(function* () {
      const agent = yield* AuthorAgent;
      const scenarios = yield* ScenarioRepo;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const scenariosRoot = path.join(ablHome, 'scenarios');

      const draft = ({ payload }: { readonly payload: AuthorRequest }) =>
        agent.draft({ description: payload.description, notes: payload.notes }).pipe(
          // A spawn/exit failure is trial-infrastructure-shaped, not something
          // the caller can act on beyond "the server is broken" - a defect.
          Effect.orDie,
          Effect.flatMap(parseAuthorOutput),
          Effect.catchTag('AuthorParseError', (error) =>
            Effect.fail(new AuthorFailed({ rawTail: tail(error.raw, AUTHOR_STDOUT_TAIL) })),
          ),
        );

      const save = ({ payload }: { readonly payload: SaveScenarioRequest }) =>
        Effect.gen(function* () {
          const { scenarioId, files } = payload;
          if (!isPlainSegment(scenarioId)) {
            return yield* Effect.fail(
              new ScenarioSavePathRejected({
                scenarioId,
                path: scenarioId,
                reason: "scenarioId must be a single path segment (no '/', '..', or empty)",
              }),
            );
          }

          const scenarioDir = path.join(scenariosRoot, scenarioId);
          yield* fs.makeDirectory(scenarioDir, { recursive: true }).pipe(Effect.orDie);
          const realScenarioDir = yield* fs.realPath(scenarioDir).pipe(Effect.orDie);

          // Directories already created and realpath-verified during this
          // save — flat drafts (the common case) hit the scenario dir itself
          // for every file, so each distinct directory costs its mkdir +
          // realpath syscalls once, not once per file.
          const verifiedDirs = new Set([scenarioDir]);

          /**
           * Resolves `file.path` against `scenarioDir` and rejects anything
           * that would land outside it: an absolute path, a `..` escape
           * (caught by comparing the resolved path back against the
           * directory via `path.relative` rather than string-matching `..`,
           * so `foo/../../bar`-style traversal is caught too), or — since
           * the directory tree is created as the files are written — a
           * pre-existing symlink among its ancestors that would redirect
           * the write elsewhere (caught by resolving the real path of the
           * write directory and re-checking it against the scenario
           * directory's own real path).
           */
          const writeSanitized = (
            file: AuthoredFile,
          ): Effect.Effect<void, ScenarioSavePathRejected> =>
            Effect.gen(function* () {
              if (path.isAbsolute(file.path)) {
                return yield* Effect.fail(
                  new ScenarioSavePathRejected({
                    scenarioId,
                    path: file.path,
                    reason: 'absolute paths are not allowed',
                  }),
                );
              }
              const resolved = path.resolve(scenarioDir, file.path);
              const relative = path.relative(scenarioDir, resolved);
              if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
                return yield* Effect.fail(
                  new ScenarioSavePathRejected({
                    scenarioId,
                    path: file.path,
                    reason: 'path escapes the scenario directory',
                  }),
                );
              }

              const dir = path.dirname(resolved);
              if (!verifiedDirs.has(dir)) {
                yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
                const realDir = yield* fs.realPath(dir).pipe(Effect.orDie);
                if (
                  realDir !== realScenarioDir &&
                  !realDir.startsWith(realScenarioDir + path.sep)
                ) {
                  return yield* Effect.fail(
                    new ScenarioSavePathRejected({
                      scenarioId,
                      path: file.path,
                      reason: 'path escapes the scenario directory via a symlink',
                    }),
                  );
                }
                verifiedDirs.add(dir);
              }

              yield* fs.writeFileString(resolved, file.content).pipe(Effect.orDie);
            });

          for (const file of files) {
            yield* writeSanitized(file);
          }

          const loaded = yield* scenarios.load(scenarioId).pipe(
            Effect.catchTags({
              // The directory was just written under a root ScenarioRepo is
              // configured with - a miss here means that configuration
              // invariant broke, not something the caller can fix.
              ScenarioNotFound: (error) => Effect.die(error),
              ScenarioInvalid: (error) =>
                Effect.fail(
                  new ScenarioSaveInvalid({ scenarioId, reason: decodeErrorReason(error.cause) }),
                ),
            }),
          );
          return loaded.definition;
        });

      return handlers.handle('draft', draft).handle('save', save);
    }),
  ).pipe(Layer.provide(authorAgent));
