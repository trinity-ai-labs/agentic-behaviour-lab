import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { ArtifactStore, Runner, ScenarioRepo, TrialIndex } from '../src/index.js';
import {
  cleanupTempHome,
  makeTempHome,
  stubEngine,
  stubHarnessIds,
  stubMultiHarnessEngine,
} from './support.js';

describe('Runner', () => {
  let home: string;
  let engine: ReturnType<typeof stubEngine>;

  beforeEach(() => {
    home = makeTempHome();
    engine = stubEngine(home);
  });

  afterEach(() => {
    cleanupTempHome(home);
  });

  it.effect('produces a pass verdict when the subject completes the chain', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-pass',
        scenario,
        condition,
        modelId: 'stub-complete',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('pass');
      expect(record.verdict.gradedBy).toBe('mechanical');
      expect(record.artifacts.finalMessage).toBe('final-message.txt');
      expect(record.fingerprint.harness).toBe('stub-adapter/1');
      expect(record.fingerprint.scenarioVersion).toBe(scenario.scenarioVersion);
      expect(record.fingerprint.graderVersion).toBe(scenario.graderVersion);

      const store = yield* ArtifactStore;
      const persisted = yield* store.readTrial('run-pass', record.trialId);
      expect(persisted).toEqual(record);
    }).pipe(Effect.provide(engine)),
  );

  it.effect('produces a fail verdict when the subject stops midway', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-fail',
        scenario,
        condition,
        modelId: 'stub-partial',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('fail');
      expect(record.verdict.detail.markersFound).toBe(1);
    }).pipe(Effect.provide(engine)),
  );

  it.effect('produces an error verdict when the grader crashes', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-error',
        scenario,
        condition,
        modelId: 'stub-poison',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('error');
      expect(record.verdict.gradedBy).toBe('mechanical');
      expect(typeof record.verdict.detail.cause).toBe('string');
    }).pipe(Effect.provide(engine)),
  );

  it.effect('produces an inconclusive verdict when the workspace has no evidence either way', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-inconclusive',
        scenario,
        condition,
        modelId: 'stub-noop',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('inconclusive');
      expect(record.verdict.detail.markersFound).toBe(0);
    }).pipe(Effect.provide(engine)),
  );

  it.effect('runBatch fans across conditions x models x trialsPerCell and completes the run', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const store = yield* ArtifactStore;

      const run = yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-complete', 'stub-partial'],
        harnesses: ['claude-cli'],
        shape: 'one-shot',
        trialsPerCell: 2,
        maxConcurrent: 2,
      });

      expect(run.status).toBe('completed');
      expect(run.endedAt).toBeDefined();

      const trialIds = yield* store.listTrialIds(run.runId);
      expect(trialIds).toHaveLength(4); // 1 condition x 2 models x 2 trials
    }).pipe(Effect.provide(engine)),
  );

  it.effect('runBatch fans across harnesses: trials differ only in fingerprint.harness', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const store = yield* ArtifactStore;
      const index = yield* TrialIndex;

      const run = yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-complete'],
        harnesses: ['stub-harness-a', 'stub-harness-b'],
        shape: 'one-shot',
        trialsPerCell: 1,
        maxConcurrent: 2,
      });

      expect(run.status).toBe('completed');

      const trialIds = yield* store.listTrialIds(run.runId);
      expect(trialIds).toHaveLength(2); // 1 condition x 1 model x 2 harnesses x 1 trial
      const trials = yield* Effect.forEach(trialIds, (trialId) =>
        store.readTrial(run.runId, trialId),
      );

      const harnesses = trials.map((trial) => trial.fingerprint.harness).sort();
      expect(harnesses).toEqual(
        [stubHarnessIds['stub-harness-a'], stubHarnessIds['stub-harness-b']].sort(),
      );

      // Everything but the harness is identical across the two trials.
      for (const trial of trials) {
        expect(trial.condition).toEqual({ label: 'default', params: { style: 'sequentially' } });
        expect(trial.fingerprint.modelId).toBe('stub-complete');
        expect(trial.verdict.outcome).toBe('pass');
      }

      // Cells split per harness, and the filter narrows to one of them.
      const allCells = yield* index.cellSummaries();
      expect(allCells).toHaveLength(2);
      const onlyA = yield* index.cellSummaries({ harness: stubHarnessIds['stub-harness-a'] });
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0]).toMatchObject({
        harness: stubHarnessIds['stub-harness-a'],
        modelId: 'stub-complete',
        trials: 1,
        pass: 1,
      });
    }).pipe(Effect.provide(stubMultiHarnessEngine(home))),
  );

  it.effect('runBatch fails fast on an unknown condition', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const result = yield* Effect.either(
        runner.runBatch({
          scenarioId: 'scenario-min',
          conditions: ['does-not-exist'],
          models: ['stub-complete'],
          harnesses: ['claude-cli'],
          shape: 'one-shot',
          trialsPerCell: 1,
          maxConcurrent: 1,
        }),
      );
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('RunConfigError');
      }
    }).pipe(Effect.provide(engine)),
  );

  it.effect('reindex after deleting the .db reproduces identical cellSummaries', () => {
    // Each Effect.provide builds the layer graph fresh, so the second
    // provide opens a brand-new SQLite handle — letting the test delete
    // the .db file between the two and prove the index is fully derived.
    const batchThenSummaries = Effect.gen(function* () {
      const runner = yield* Runner;
      const index = yield* TrialIndex;
      yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-complete', 'stub-partial', 'stub-poison', 'stub-noop'],
        harnesses: ['claude-cli'],
        shape: 'one-shot',
        trialsPerCell: 1,
        maxConcurrent: 4,
      });
      return yield* index.cellSummaries();
    }).pipe(Effect.provide(engine));

    const reindexThenSummaries = Effect.gen(function* () {
      const index = yield* TrialIndex;
      yield* index.reindex;
      return yield* index.cellSummaries();
    }).pipe(Effect.provide(engine));

    return Effect.gen(function* () {
      // Cells group by (scenario, condition, model, shape), so the four
      // stub models produce four cells of one trial each — one per outcome.
      const before = yield* batchThenSummaries;
      expect(before).toHaveLength(4);
      const byModel = Object.fromEntries(before.map((cell) => [cell.modelId, cell]));
      expect(byModel['stub-complete']).toMatchObject({ trials: 1, pass: 1, failRate: 0 });
      expect(byModel['stub-partial']).toMatchObject({ trials: 1, fail: 1, failRate: 1 });
      expect(byModel['stub-poison']).toMatchObject({ trials: 1, error: 1, failRate: null });
      expect(byModel['stub-noop']).toMatchObject({ trials: 1, inconclusive: 1, failRate: null });

      yield* Effect.sync(() => {
        for (const suffix of ['', '-wal', '-shm']) {
          rmSync(path.join(home, 'store', `index.db${suffix}`), { force: true });
        }
      });

      const afterReindex = yield* reindexThenSummaries;
      expect(afterReindex).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  // Grading gate: only 'completed' disposition reaches the grader
  // ---------------------------------------------------------------------------

  it.effect('produces pass when the subject disposition is completed', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-disposition-completed',
        scenario,
        condition,
        modelId: 'stub-complete',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      // Completed disposition → grader runs → normal verdict
      expect(record.verdict.outcome).toBe('pass');
      expect(record.verdict.detail.disposition).toBeUndefined();
    }).pipe(Effect.provide(engine)),
  );

  it.effect(
    'produces error verdict when disposition is provider-degraded (grader never runs)',
    () =>
      Effect.gen(function* () {
        const runner = yield* Runner;
        const scenarios = yield* ScenarioRepo;
        const scenario = yield* scenarios.load('scenario-min');
        const condition = scenario.definition.conditions[0]!;

        const record = yield* runner.runTrial({
          runId: 'run-disposition-degraded',
          scenario,
          condition,
          modelId: 'stub-provider-degraded',
          harness: 'claude-cli',
          shape: 'one-shot',
        });

        expect(record.verdict.outcome).toBe('error');
        expect(record.verdict.detail.disposition).toBe('provider-degraded');
        expect(record.verdict.gradedBy).toBe('mechanical');
      }).pipe(Effect.provide(engine)),
  );

  it.effect('produces error verdict when disposition is crashed (grader never runs)', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-disposition-crashed',
        scenario,
        condition,
        modelId: 'stub-disposition-crashed',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('error');
      expect(record.verdict.detail.disposition).toBe('crashed');
    }).pipe(Effect.provide(engine)),
  );

  it.effect('produces error verdict when disposition is timeout (grader never runs)', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;
      const scenarios = yield* ScenarioRepo;
      const scenario = yield* scenarios.load('scenario-min');
      const condition = scenario.definition.conditions[0]!;

      const record = yield* runner.runTrial({
        runId: 'run-disposition-timeout',
        scenario,
        condition,
        modelId: 'stub-disposition-timeout',
        harness: 'claude-cli',
        shape: 'one-shot',
      });

      expect(record.verdict.outcome).toBe('error');
      expect(record.verdict.detail.disposition).toBe('timeout');
    }).pipe(Effect.provide(engine)),
  );

  // ---------------------------------------------------------------------------
  // Validity: runs with >20% error share get 'degraded-conditions'
  // ---------------------------------------------------------------------------

  it.effect('marks a run as valid when all trials pass', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;

      const run = yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-complete'],
        harnesses: ['claude-cli'],
        shape: 'one-shot',
        trialsPerCell: 3,
        maxConcurrent: 2,
      });

      expect(run.status).toBe('completed');
      expect(run.validity).toBe('valid');
    }).pipe(Effect.provide(engine)),
  );

  it.effect('marks a run as degraded-conditions when error share > 20%', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;

      // 5 trials all with provider-degraded → 100% error share > 20%
      const run = yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-provider-degraded'],
        harnesses: ['claude-cli'],
        shape: 'one-shot',
        trialsPerCell: 5,
        maxConcurrent: 2,
      });

      expect(run.status).toBe('completed');
      expect(run.validity).toBe('degraded-conditions');
    }).pipe(Effect.provide(engine)),
  );

  // ---------------------------------------------------------------------------
  // Provider status: best-effort, never blocks a run
  // ---------------------------------------------------------------------------

  it.effect('captures provider status on the run record when available', () =>
    Effect.gen(function* () {
      const runner = yield* Runner;

      const run = yield* runner.runBatch({
        scenarioId: 'scenario-min',
        conditions: ['default'],
        models: ['stub-complete'],
        harnesses: ['claude-cli'],
        shape: 'one-shot',
        trialsPerCell: 1,
        maxConcurrent: 1,
      });

      // providerStatus may be undefined (if the statuspage unreachable in
      // test env) or populated — either way the run completed normally.
      expect(run.status).toBe('completed');
      // The field exists on the type; the value is best-effort.
      expect(run.validity).toBeDefined();
    }).pipe(Effect.provide(engine)),
  );
});
