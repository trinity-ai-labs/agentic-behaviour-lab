#!/usr/bin/env node
/**
 * Seeds a local ABL_HOME with a StubAdapter-backed run for dashboard
 * development: 2 conditions x 4 synthetic "models" (varying pass rates, one
 * flaky enough to produce inconclusive too) x 2 harnesses, 8 trials per
 * cell — a realistic-looking comparison grid with no real agent spawned and
 * no API spend. Requires @abl/engine to be built first (`pnpm --filter
 * @abl/engine build`) since it imports the package's dist output, exactly
 * as `abl-serve` does.
 *
 *   pnpm --filter @abl/web seed-dev
 *
 * Writes into `defaultAblHome()` (`$ABL_HOME`, else `~/.abl`) — the same
 * resolution `abl-serve` uses — so set ABL_HOME to a scratch directory
 * before running this AND before starting `abl-serve`, or the seed lands in
 * (and `abl-serve` reads from) your real `~/.abl`. The dev scenario
 * (scripts/dev-scenario/) is copied into `<ABL_HOME>/scenarios/` so
 * `abl-serve`'s default scenario roots discover it with no extra config.
 */
import { NodeContext } from '@effect/platform-node';
import {
  CLAUDE_CLI_HARNESS,
  CODEX_CLI_HARNESS,
  EngineLive,
  StubAdapterLive,
  defaultAblHome,
  Runner,
  TrialIndex,
} from '@abl/engine';
import { Effect, Layer } from 'effect';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const devScenarioSrc = join(scriptDir, 'dev-scenario');

const ablHome = defaultAblHome();
const scenariosDir = join(ablHome, 'scenarios');
const devScenarioDest = join(scenariosDir, 'dev-comparison');

mkdirSync(scenariosDir, { recursive: true });
cpSync(devScenarioSrc, devScenarioDest, { recursive: true });

const subjectsDir = join(devScenarioSrc, 'subjects');
const stubScripts = {
  strong: join(subjectsDir, 'strong.mjs'),
  mixed: join(subjectsDir, 'mixed.mjs'),
  weak: join(subjectsDir, 'weak.mjs'),
  flaky: join(subjectsDir, 'flaky.mjs'),
  broken: join(subjectsDir, 'broken.mjs'),
};

const engine = EngineLive({
  ablHome,
  scenarioRoots: [scenariosDir],
  adapters: {
    [CLAUDE_CLI_HARNESS]: StubAdapterLive(
      stubScripts,
      'claude-code/2.3.1 (headless -p) [dev-seed stub]',
    ),
    [CODEX_CLI_HARNESS]: StubAdapterLive(stubScripts, 'codex-cli/0.42.0 (exec) [dev-seed stub]'),
  },
}).pipe(Layer.provide(NodeContext.layer));

const program = Effect.gen(function* () {
  const runner = yield* Runner;
  const index = yield* TrialIndex;

  yield* Effect.log(`seeding ABL_HOME: ${ablHome}`);

  const run = yield* runner.runBatch({
    scenarioId: 'dev-comparison',
    conditions: ['baseline', 'guarded'],
    models: ['strong', 'mixed', 'weak', 'flaky', 'broken'],
    harnesses: [CLAUDE_CLI_HARNESS, CODEX_CLI_HARNESS],
    shape: 'one-shot',
    trialsPerCell: 8,
    maxConcurrent: 8,
  });

  yield* Effect.log(`run ${run.runId} ${run.status}`);

  const summaries = yield* index.cellSummaries();
  console.table(
    summaries.map((cell) => ({
      condition: cell.condition,
      model: cell.modelId,
      harness: cell.harness.split(' ')[0],
      trials: cell.trials,
      pass: cell.pass,
      fail: cell.fail,
      inconclusive: cell.inconclusive,
      error: cell.error,
      failRate: cell.failRate,
    })),
  );

  console.log(
    `\nSeed complete. Start the server against this data with:\n  ABL_HOME=${ablHome} node packages/server/dist/main.js\n`,
  );
});

Effect.runPromise(program.pipe(Effect.provide(engine))).catch((err) => {
  console.error(err);
  process.exit(1);
});
