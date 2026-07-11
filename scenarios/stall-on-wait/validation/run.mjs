// StubAdapter validation run for stall-on-wait: drives the built engine
// end-to-end (ScenarioRepo load -> fixture -> stub subject -> grader ->
// trial.json) with three stub subjects that must produce pass, fail, and
// inconclusive, then copies each trial's raw artifacts into runs/ and fails
// loudly on any unexpected verdict.
//
// Prerequisite: pnpm --filter @abl/engine build
// Run: node scenarios/stall-on-wait/validation/run.mjs
//
// This file lives outside every pnpm workspace package, so bare specifiers
// like "effect" do not resolve from here. It resolves them through the
// engine's own dependency graph instead: createRequire anchored at the
// engine dist finds each package root, and the package.json "." export's
// "import" condition picks the SAME ESM build the engine's own imports load
// — mixing the CJS build in would construct Effect values from a second
// module instance.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const validationDir = dirname(fileURLToPath(import.meta.url));
const scenariosRoot = join(validationDir, '..', '..');
const engineDist = join(scenariosRoot, '..', 'packages', 'engine', 'dist', 'index.js');

const requireFromEngine = createRequire(engineDist);
const importEsm = async (specifier) => {
  const packageJsonPath = requireFromEngine.resolve(`${specifier}/package.json`);
  const packageRoot = dirname(packageJsonPath);
  const entry = JSON.parse(readFileSync(packageJsonPath, 'utf8')).exports['.'].import;
  return import(pathToFileURL(join(packageRoot, entry)).href);
};

const [{ Effect, Layer }, { NodeContext }, engine] = await Promise.all([
  importEsm('effect'),
  importEsm('@effect/platform-node'),
  import(pathToFileURL(engineDist).href),
]);

// Short review so the complete subject's foreground wait costs seconds, not
// a minute; the stall subject overrides it upward for its detached child.
process.env.ABL_STALL_REVIEW_SECONDS = '2';

const expected = {
  'stub-complete': 'pass',
  'stub-stall': 'fail',
  'stub-noop': 'inconclusive',
};

const ablHome = mkdtempSync(join(tmpdir(), 'abl-stall-validation-'));

const engineLayer = engine
  .EngineLive({
    ablHome,
    scenarioRoots: [scenariosRoot],
    adapter: engine.StubAdapterLive({
      'stub-complete': join(validationDir, 'subjects', 'complete.mjs'),
      'stub-stall': join(validationDir, 'subjects', 'stall.mjs'),
      'stub-noop': join(validationDir, 'subjects', 'noop.mjs'),
    }),
  })
  .pipe(Layer.provide(NodeContext.layer));

const program = Effect.gen(function* () {
  const runner = yield* engine.Runner;
  return yield* runner.runBatch({
    scenarioId: 'stall-on-wait',
    conditions: ['baseline'],
    models: Object.keys(expected),
    shape: 'one-shot',
    trialsPerCell: 1,
    maxConcurrent: 1,
  });
});

try {
  const run = await Effect.runPromise(program.pipe(Effect.provide(engineLayer)));

  const runDir = join(ablHome, 'store', 'runs', run.runId);
  const runsOut = join(validationDir, 'runs', 'baseline');
  rmSync(runsOut, { recursive: true, force: true });

  let failed = false;
  for (const trialId of readdirSync(runDir)) {
    if (trialId === 'run.json') continue;
    const trial = JSON.parse(readFileSync(join(runDir, trialId, 'trial.json'), 'utf8'));
    const model = trial.fingerprint.modelId;
    const want = expected[model];
    const got = trial.verdict.outcome;
    const ok = got === want;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${model}: ${got} (expected ${want}) — chainStep=${trial.verdict.detail.chainStep ?? 'n/a'}`,
    );
    // Commit the raw per-trial artifacts under a stable per-model name so
    // the validation evidence is re-derivable from the repo.
    cpSync(join(runDir, trialId), join(runsOut, model), { recursive: true });
  }

  if (failed) {
    console.error('validation FAILED: grader did not discriminate as expected');
    process.exit(1);
  }
  console.log(`validation OK — artifacts copied to ${runsOut}`);
} finally {
  rmSync(ablHome, { recursive: true, force: true });
}
