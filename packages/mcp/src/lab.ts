/**
 * Effect-level lab operations behind the MCP tools. Each returns a plain
 * JSON-serializable value; `tools.ts` wraps them into MCP tool results.
 * Everything here consumes the engine's public surface only, and every
 * derived view (per-run progress, per-run summaries) is computed from the
 * artifact store's flat files or the SQLite index — the read sides the
 * engine already exposes.
 */
import {
  ArtifactStore,
  MODEL_PROVIDERS,
  Runner,
  ScenarioRepo,
  StoreError,
  TrialIndex,
  type ArtifactStoreShape,
  type CellSummary,
  type ExecutionShape,
  type IndexError,
  type RunBatchError,
  type RunConfig,
  type RunRecord,
  type TrialRecord,
  type VerdictOutcome,
} from '@abl/engine';
import { FileSystem, Path } from '@effect/platform';
import { Cause, Data, Effect, Exit, Fiber, Option } from 'effect';

// ---------------------------------------------------------------------------
// Scenario discovery
// ---------------------------------------------------------------------------

/**
 * The agent-facing scenario listing: the definition minus its script paths,
 * which only mean something to the runner on this machine.
 */
export const listScenarios = Effect.gen(function* () {
  const repo = yield* ScenarioRepo;
  const definitions = yield* repo.list;
  return definitions.map((definition) => ({
    scenarioId: definition.scenarioId,
    version: definition.version,
    title: definition.title,
    family: definition.family,
    description: definition.description,
    conditions: definition.conditions,
    declaredShapes: definition.declaredShapes,
  }));
});

/**
 * The model catalog as a flat list of provider groups — served to agents so
 * they know which model ids are valid before launching a run.
 */
export const listModels = Effect.succeed(
  MODEL_PROVIDERS.map((group) => ({
    provider: group.provider,
    label: group.label,
    models: group.models.map((m) => ({
      value: m.value,
      label: m.label,
      intelligence: m.intelligence,
      ...(m.status !== undefined ? { status: m.status } : {}),
    })),
  })),
);

// ---------------------------------------------------------------------------
// Run registry — fire-and-poll
// ---------------------------------------------------------------------------

export interface RunHandle {
  readonly runId: string;
}

export interface TrialProgress {
  readonly trialId: string;
  readonly condition: string;
  readonly modelId: string;
  readonly harness: string;
  readonly outcome: VerdictOutcome;
}

export interface RunStatus {
  readonly run: RunRecord;
  readonly plannedTrials: number;
  readonly completedTrials: number;
  readonly cells: ReadonlyArray<CellSummary>;
  readonly trials: ReadonlyArray<TrialProgress>;
  readonly batchError?: string | undefined;
}

export interface RunRegistry {
  readonly launchRun: (
    config: RunConfig,
  ) => Effect.Effect<RunHandle, RunBatchError, Runner | ArtifactStore>;
  readonly runStatus: (runId: string) => Effect.Effect<RunStatus, StoreError, ArtifactStore>;
}

/**
 * Owns the state one fire-and-poll session needs: a fiber handle per
 * launched batch (the only witness of a batch that died mid-run) and a
 * gate serializing launches so runId detection stays unambiguous. Both
 * live privately in this closure; callers wire the two operations to
 * whatever protocol they serve.
 */
export const makeRunRegistry = (): RunRegistry => {
  const running = new Map<string, Fiber.RuntimeFiber<RunRecord, RunBatchError>>();
  const launchGate = Effect.unsafeMakeSemaphore(1);

  /**
   * Forks a batch onto a daemon fiber and returns its runId without waiting
   * for any trial. The engine only reveals a batch's runId when the whole
   * batch resolves, but the run record is the batch's first store write — so
   * the runId is recovered by snapshotting the store's run ids before the
   * fork and watching for the one new id.
   */
  const launchRun: RunRegistry['launchRun'] = (config) =>
    launchGate.withPermits(1)(
      Effect.gen(function* () {
        const store = yield* ArtifactStore;
        const runner = yield* Runner;

        const before = new Set(yield* store.listRunIds);
        const fiber = yield* Effect.forkDaemon(runner.runBatch(config));

        const detectNewRun = Effect.gen(function* () {
          while (true) {
            const ids = yield* store.listRunIds;
            const fresh = ids.find((id) => !before.has(id));
            if (fresh !== undefined) return fresh;
            yield* Effect.sleep('25 millis');
          }
        });

        // A batch that fails before writing its run record (unknown scenario,
        // bad condition label) would leave the detector polling forever, so
        // the fiber's own outcome is raced in: an early failure surfaces as
        // the tool error, and a batch that finishes before detection yields
        // its runId directly.
        const runId = yield* Effect.raceFirst(
          detectNewRun,
          Fiber.join(fiber).pipe(Effect.map((run) => run.runId)),
        );
        running.set(runId, fiber);
        return { runId };
      }),
    );

  /**
   * A run's record plus progress derived from its trial files: planned vs
   * completed counts, per-cell summaries, and per-trial outcomes (the ids an
   * agent needs to call `lab_get_trial`).
   */
  const runStatus: RunRegistry['runStatus'] = (runId) =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore;
      const [run, trials] = yield* Effect.all([store.readRun(runId), readRunTrials(store, runId)], {
        concurrency: 2,
      });

      // Once run.json is terminal the batch's outcome is fully on disk and
      // the fiber handle can be dropped. A batch that died mid-run instead
      // leaves run.json at "running" forever, so its fiber stays registered:
      // the exit is the only evidence, and the reported status is downgraded
      // to "aborted" from it.
      if (run.status !== 'running') running.delete(runId);
      const exit = run.status === 'running' ? (running.get(runId)?.unsafePoll() ?? null) : null;
      const batchError =
        exit !== null && Exit.isFailure(exit) ? Cause.pretty(exit.cause) : undefined;

      return {
        run: batchError !== undefined ? { ...run, status: 'aborted' as const } : run,
        plannedTrials:
          run.config.conditions.length *
          run.config.models.length *
          run.config.harnesses.length *
          run.config.trialsPerCell,
        completedTrials: trials.length,
        cells: summarizeCells(trials, run.validity),
        trials: trials.map((trial) => ({
          trialId: trial.trialId,
          condition: trial.condition.label,
          modelId: trial.fingerprint.modelId,
          harness: trial.fingerprint.harness,
          outcome: trial.verdict.outcome,
        })),
        batchError,
      };
    });

  return { launchRun, runStatus };
};

// ---------------------------------------------------------------------------
// Results — cell summaries
// ---------------------------------------------------------------------------

export interface ResultsFilter {
  readonly scenarioId?: string | undefined;
  readonly runId?: string | undefined;
  readonly models?: ReadonlyArray<string> | undefined;
  readonly conditions?: ReadonlyArray<string> | undefined;
  /** Fingerprint harness strings (as reported in cell rows), e.g. "claude-code/2.1.206 (headless -p)". */
  readonly harnesses?: ReadonlyArray<string> | undefined;
}

/**
 * Cell summaries with optional filters. Global queries go through the
 * SQLite index; a `runId` filter is served by aggregating that run's trial
 * files instead, because the index aggregates across all runs and carries
 * no run column. Model/condition filters apply in-memory either way — cell
 * rows are already tiny.
 */
export const results = (
  filter: ResultsFilter,
): Effect.Effect<ReadonlyArray<CellSummary>, StoreError | IndexError, ArtifactStore | TrialIndex> =>
  Effect.gen(function* () {
    // scenarioId is also pushed down into the index query so a long run
    // history is filtered by SQL, not scanned; the in-memory predicate below
    // still applies it uniformly for the per-run branch.
    const cells =
      filter.runId !== undefined
        ? yield* Effect.gen(function* () {
            const store = yield* ArtifactStore;
            const run = yield* store.readRun(filter.runId!).pipe(Effect.option, Effect.orDie);
            const trials = yield* readRunTrials(store, filter.runId!);
            return summarizeCells(
              trials,
              Option.match(run, {
                onNone: () => undefined,
                onSome: (r) => r.validity,
              }),
            );
          })
        : yield* (yield* TrialIndex).cellSummaries(
            filter.scenarioId !== undefined ? { scenarioId: filter.scenarioId } : undefined,
          );
    return cells.filter(
      (cell) =>
        (filter.scenarioId === undefined || cell.scenarioId === filter.scenarioId) &&
        (filter.models === undefined || filter.models.includes(cell.modelId)) &&
        (filter.conditions === undefined || filter.conditions.includes(cell.condition)) &&
        (filter.harnesses === undefined || filter.harnesses.includes(cell.harness)),
    );
  });

// ---------------------------------------------------------------------------
// Single trial — record + inlined artifacts
// ---------------------------------------------------------------------------

export class TrialNotFound extends Data.TaggedError('TrialNotFound')<{
  readonly trialId: string;
}> {}

/** Per-artifact inline cap: enough for final messages and state logs, bounded because an agent context is the consumer. */
const ARTIFACT_INLINE_CAP = 16 * 1024;

export interface InlinedArtifact {
  readonly path: string;
  readonly sizeBytes: number;
  readonly content: string;
  readonly truncated: boolean;
}

export interface TrialDetail {
  readonly trial: TrialRecord;
  readonly artifacts: Readonly<Record<string, InlinedArtifact>>;
}

/**
 * One trial record with its artifact files inlined (truncated past the
 * cap). Trial ids are UUIDs, so a bare id is unambiguous; passing the
 * optional runId skips the cross-run scan.
 */
export const getTrial = (
  trialId: string,
  runId?: string,
): Effect.Effect<
  TrialDetail,
  StoreError | TrialNotFound,
  ArtifactStore | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const trial =
      runId !== undefined
        ? yield* store.readTrial(runId, trialId)
        : yield* findTrial(store, trialId);

    const dir = store.trialDir(trial.runId, trial.trialId);
    const entries = yield* Effect.forEach(
      Object.entries(trial.artifacts),
      ([name, relPath]) => {
        const file = path.join(dir, relPath);
        return fs.readFileString(file).pipe(
          Effect.mapError(
            (cause) => new StoreError({ operation: 'readArtifact', path: file, cause }),
          ),
          Effect.map(
            (content) =>
              [
                name,
                {
                  path: relPath,
                  sizeBytes: Buffer.byteLength(content, 'utf8'),
                  content:
                    content.length > ARTIFACT_INLINE_CAP
                      ? content.slice(0, ARTIFACT_INLINE_CAP)
                      : content,
                  truncated: content.length > ARTIFACT_INLINE_CAP,
                },
              ] as const,
          ),
        );
      },
      { concurrency: 8 },
    );
    return { trial, artifacts: Object.fromEntries(entries) };
  });

const findTrial = (
  store: ArtifactStoreShape,
  trialId: string,
): Effect.Effect<TrialRecord, StoreError | TrialNotFound> =>
  Effect.gen(function* () {
    for (const runId of yield* store.listRunIds) {
      const trialIds = yield* store.listTrialIds(runId);
      if (trialIds.includes(trialId)) return yield* store.readTrial(runId, trialId);
    }
    return yield* Effect.fail(new TrialNotFound({ trialId }));
  });

// ---------------------------------------------------------------------------
// Shared read-side helpers
// ---------------------------------------------------------------------------

const readRunTrials = (
  store: ArtifactStoreShape,
  runId: string,
): Effect.Effect<ReadonlyArray<TrialRecord>, StoreError> =>
  store
    .listTrialIds(runId)
    .pipe(
      Effect.flatMap((trialIds) =>
        Effect.forEach(trialIds, (trialId) => store.readTrial(runId, trialId), { concurrency: 16 }),
      ),
    );

interface CellAccumulator {
  readonly scenarioId: string;
  readonly condition: string;
  readonly modelId: string;
  readonly harness: string;
  readonly shape: ExecutionShape;
  pass: number;
  fail: number;
  inconclusive: number;
  error: number;
}

/**
 * Groups trial records into the same cell rows the SQLite index serves —
 * used for the per-run views the index cannot filter to. failRate mirrors
 * the index's definition: fail / (pass + fail), null until graded trials
 * exist. An optional `validity` propagates the run-level provider-health
 * flag to every cell derived from that run.
 */
const summarizeCells = (
  trials: ReadonlyArray<TrialRecord>,
  validity?: CellSummary['validity'],
): Array<CellSummary> => {
  const cells = new Map<string, CellAccumulator>();
  for (const trial of trials) {
    const key = `${trial.scenarioId} ${trial.condition.label} ${trial.fingerprint.modelId} ${trial.fingerprint.harness} ${trial.shape}`;
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = {
        scenarioId: trial.scenarioId,
        condition: trial.condition.label,
        modelId: trial.fingerprint.modelId,
        harness: trial.fingerprint.harness,
        shape: trial.shape,
        pass: 0,
        fail: 0,
        inconclusive: 0,
        error: 0,
      };
      cells.set(key, cell);
    }
    cell[trial.verdict.outcome] += 1;
  }
  const sortKey = (cell: CellAccumulator): string =>
    `${cell.scenarioId} ${cell.condition} ${cell.modelId} ${cell.harness} ${cell.shape}`;
  return [...cells.values()]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .map((cell): CellSummary => ({
      ...cell,
      trials: cell.pass + cell.fail + cell.inconclusive + cell.error,
      failRate: cell.pass + cell.fail > 0 ? cell.fail / (cell.pass + cell.fail) : null,
      validity,
    }));
};
