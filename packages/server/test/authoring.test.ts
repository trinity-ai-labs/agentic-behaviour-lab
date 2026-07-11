// The authoring endpoints over real HTTP, with the `claude` CLI call
// replaced by `AuthorAgentStubLive` running a node fixture script — no real
// agent is ever invoked here. Composes the API from the individually
// exported groups (rather than the production `ApiLive`, which bakes in the
// real CLI by default) so each test controls exactly which fixture the
// "CLI" prints.
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { HttpApiBuilder, HttpApiClient } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { EngineLive } from '@abl/engine';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AblApi } from '../src/api.js';
import { AuthorAgentStubLive, AuthoringLive } from '../src/authoring.js';
import { ResultsLive, RunsLive, ScenariosLive, TrialsLive } from '../src/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'authoring');
const goodDraftScript = path.join(fixturesDir, 'good-draft.mjs');
const malformedDraftScript = path.join(fixturesDir, 'malformed-draft.mjs');

const serverLayer = (ablHome: string, authorScriptPath: string) =>
  HttpApiBuilder.serve().pipe(
    Layer.provide(
      HttpApiBuilder.api(AblApi).pipe(
        Layer.provide([
          ScenariosLive,
          RunsLive,
          ResultsLive,
          TrialsLive,
          AuthoringLive(ablHome, AuthorAgentStubLive(authorScriptPath)),
        ]),
      ),
    ),
    Layer.provide(
      EngineLive({
        ablHome,
        scenarioRoots: [path.join(ablHome, 'scenarios')],
        adapters: {},
      }),
    ),
    // layerTest binds a real Node server to an ephemeral 127.0.0.1 port and
    // provides an HttpClient already pointed at it, plus NodeContext for
    // FileSystem/Path/CommandExecutor (the stub agent still spawns a real
    // `node <script>` subprocess — just never the real `claude` binary).
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

describe('@abl/server authoring endpoints', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'abl-authoring-test-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it.live(
    'drafts a scenario, saves it, and the saved scenario loads via ScenarioRepo',
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(AblApi);

        const drafted = yield* client.authoring.draft({
          payload: { description: 'Test whether the subject stalls on a slow spawned wait.' },
        });
        expect(drafted.rationale.length).toBeGreaterThan(0);
        expect(drafted.files.map((file) => file.path).sort()).toEqual([
          'brief.md',
          'fixture.mjs',
          'grader.mjs',
          'scenario.json',
        ]);
        const scenarioJson = drafted.files.find((file) => file.path === 'scenario.json')!;
        expect(JSON.parse(scenarioJson.content).scenarioId).toBe('authored-min');

        const saved = yield* client.authoring.save({
          payload: { scenarioId: 'authored-min', files: drafted.files },
        });
        expect(saved.scenarioId).toBe('authored-min');
        expect(saved.family).toBe('test-fixture');

        // The full loop: what was saved is not just written to disk but
        // actually loadable through ScenarioRepo (the same repo `GET
        // /api/scenarios` and every trial run reads from).
        const scenarios = yield* client.scenarios.list();
        expect(scenarios.map((scenario) => scenario.scenarioId)).toContain('authored-min');
      }).pipe(Effect.provide(serverLayer(home, goodDraftScript))),
    30_000,
  );

  it.live(
    "rejects path-traversal attempts in a saved file's path",
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(AblApi);

        const escapeAttempts = [
          { path: '../../etc/evil.txt', content: 'pwned' },
          { path: '/etc/evil.txt', content: 'pwned' },
        ];

        for (const file of escapeAttempts) {
          const rejected = yield* client.authoring
            .save({ payload: { scenarioId: 'traversal-test', files: [file] } })
            .pipe(Effect.flip);
          expect(rejected._tag).toBe('ScenarioSavePathRejected');
        }
      }).pipe(Effect.provide(serverLayer(home, goodDraftScript))),
    30_000,
  );

  it.live(
    'surfaces malformed authoring output as a 502 AuthorFailed with the raw tail',
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(AblApi);

        const failed = yield* client.authoring
          .draft({ payload: { description: 'Draft anything.' } })
          .pipe(Effect.flip);
        expect(failed._tag).toBe('AuthorFailed');
        expect((failed as { rawTail: string }).rawTail).toContain("couldn't draft");
      }).pipe(Effect.provide(serverLayer(home, malformedDraftScript))),
    30_000,
  );
});
