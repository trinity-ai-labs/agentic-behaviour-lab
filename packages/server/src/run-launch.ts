/**
 * Launching a run without blocking on it. `Runner.runBatch` only surfaces
 * its runId once the entire batch has finished, so a non-blocking
 * POST /api/runs cannot use it; this module re-derives the same
 * validate → record → fan-out sequence from the engine's public pieces
 * (`ScenarioRepo.load`, `ArtifactStore.writeRun`, `Runner.runTrial`), with
 * the batch forked as a daemon fiber instead of awaited. It is the one place
 * that duplicates `runBatch`'s validation and cell fan-out policy — delete
 * it in favour of `runBatch` once the engine exposes the runId at batch
 * start.
 */
import {
  ArtifactStore,
  Runner,
  ScenarioRepo,
  type LoadedScenario,
  type RunConfig,
  type RunRecord,
  type RunTrialParams,
} from '@abl/engine';
import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { RunRejected, ScenarioNotFound, type RunStarted } from './api.js';

const nowIso = (): string => new Date().toISOString();

interface Cell {
  readonly condition: RunTrialParams['condition'];
  readonly modelId: string;
  readonly harness: string;
}

/** Every (condition × model × harness × trial-index) the config promises — one entry per trial to run. */
const deriveCells = (
  scenario: LoadedScenario,
  config: RunConfig,
): Effect.Effect<ReadonlyArray<Cell>, RunRejected> => {
  const byLabel = new Map(
    scenario.definition.conditions.map((condition) => [condition.label, condition]),
  );
  const missing = config.conditions.filter((label) => !byLabel.has(label));
  if (missing.length > 0) {
    return Effect.fail(
      new RunRejected({
        reason: `unknown condition(s) for scenario "${config.scenarioId}": ${missing.join(', ')} (known: ${[...byLabel.keys()].join(', ')})`,
      }),
    );
  }
  return Effect.succeed(
    config.conditions.flatMap((label) => {
      // Safe: every label in config.conditions was validated against byLabel above.
      const condition = byLabel.get(label)!;
      return config.models.flatMap((modelId) =>
        config.harnesses.flatMap((harness) =>
          Array.from({ length: config.trialsPerCell }, () => ({ condition, modelId, harness })),
        ),
      );
    }),
  );
};

/**
 * Validates the config, records the run as `running`, then forks the trial
 * fan-out so the caller gets the runId immediately. Clients follow the run
 * via GET /api/runs/:runId until its status leaves "running".
 */
export const launchRun = (
  config: RunConfig,
): Effect.Effect<
  RunStarted,
  ScenarioNotFound | RunRejected,
  Runner | ScenarioRepo | ArtifactStore
> =>
  Effect.gen(function* () {
    const scenarios = yield* ScenarioRepo;
    const store = yield* ArtifactStore;
    const runner = yield* Runner;

    const scenario = yield* scenarios.load(config.scenarioId).pipe(
      Effect.catchTags({
        ScenarioNotFound: () =>
          Effect.fail(new ScenarioNotFound({ scenarioId: config.scenarioId })),
        ScenarioInvalid: (cause) => Effect.die(cause),
      }),
    );
    const cells = yield* deriveCells(scenario, config);

    const runId = randomUUID();
    const running: RunRecord = { runId, config, startedAt: nowIso(), status: 'running' };
    yield* store.writeRun(running).pipe(Effect.orDie);

    const batch = Effect.forEach(
      cells,
      ({ condition, modelId, harness }) =>
        runner.runTrial({ runId, scenario, condition, modelId, harness, shape: config.shape }),
      { concurrency: config.maxConcurrent, discard: true },
    ).pipe(
      Effect.matchCauseEffect({
        onSuccess: () => store.writeRun({ ...running, status: 'completed', endedAt: nowIso() }),
        onFailure: (cause) =>
          Effect.logError(`run ${runId} aborted`, cause).pipe(
            Effect.zipRight(store.writeRun({ ...running, status: 'aborted', endedAt: nowIso() })),
          ),
      }),
      // A failed terminal writeRun means the store itself broke: die like
      // every other store call — the defect is logged when the fiber ends.
      Effect.orDie,
    );

    // Daemon fork: the request fiber is interrupted as soon as the response
    // is sent, so the batch must live in the global scope.
    yield* Effect.forkDaemon(batch);

    return { runId };
  });
