/**
 * `TrialIndex` is a derived, rebuildable SQLite index over the flat-file
 * store — never the source of truth. `reindex` drops and rebuilds it by
 * scanning every `trial.json` on disk; `insertTrial` keeps it current
 * incrementally as the runner writes each trial. Wraps `better-sqlite3`'s
 * synchronous API behind `Effect.sync`/`Effect.try`, per the project's
 * "sync API is fine behind Effect.sync" convention for this kind of
 * Node-only, non-blocking-in-practice call.
 */
import { FileSystem, Path } from '@effect/platform';
import Database from 'better-sqlite3';
import { Context, Data, Effect, Layer, Option } from 'effect';
import { CellSummary, ExecutionShape, TrialRecord } from './schema.js';
import { ArtifactStore } from './store.js';

export class IndexError extends Data.TaggedError('IndexError')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export interface CellFilter {
  readonly scenarioId?: string | undefined;
  readonly shape?: ExecutionShape | undefined;
  /** Exact fingerprint harness string, e.g. "claude-code/2.1.206 (headless -p)". */
  readonly harness?: string | undefined;
}

export interface TrialIndexShape {
  /** Drops and rebuilds the index by scanning every trial.json under the artifact store. */
  readonly reindex: Effect.Effect<void, IndexError>;
  /** Indexes one trial — called right after its `trial.json` is written. */
  readonly insertTrial: (trial: TrialRecord) => Effect.Effect<void, IndexError>;
  /** Upserts a run's validity into the runs table — called after the run completes and validity is computed. */
  readonly upsertValidity: (
    runId: string,
    validity: 'valid' | 'degraded-conditions',
  ) => Effect.Effect<void, IndexError>;
  readonly cellSummaries: (
    filter?: CellFilter,
  ) => Effect.Effect<ReadonlyArray<CellSummary>, IndexError>;
}

export class TrialIndex extends Context.Tag('@abl/engine/TrialIndex')<
  TrialIndex,
  TrialIndexShape
>() {}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trials (
  trial_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  condition_label TEXT NOT NULL,
  model_id TEXT NOT NULL,
  harness TEXT NOT NULL,
  shape TEXT NOT NULL,
  outcome TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trials_cell_idx ON trials (scenario_id, condition_label, model_id, harness, shape);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  validity TEXT
);
`;

interface TrialRow {
  readonly trialId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly conditionLabel: string;
  readonly modelId: string;
  readonly harness: string;
  readonly shape: string;
  readonly outcome: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

const rowOf = (trial: TrialRecord): TrialRow => ({
  trialId: trial.trialId,
  runId: trial.runId,
  scenarioId: trial.scenarioId,
  conditionLabel: trial.condition.label,
  modelId: trial.fingerprint.modelId,
  harness: trial.fingerprint.harness,
  shape: trial.shape,
  outcome: trial.verdict.outcome,
  startedAt: trial.startedAt,
  endedAt: trial.endedAt,
});

interface CellRow {
  readonly scenario_id: string;
  readonly condition_label: string;
  readonly model_id: string;
  readonly harness: string;
  readonly shape: ExecutionShape;
  readonly pass: number;
  readonly fail: number;
  readonly inconclusive: number;
  readonly error: number;
  readonly trials: number;
  readonly validity: string | null;
}

const failWith =
  (operation: string) =>
  (cause: unknown): IndexError =>
    new IndexError({ operation, cause });

/** `<ArtifactStore.root>/index.db` — co-located with the store it indexes, so the two can never point at different roots. */
export const TrialIndexLive: Layer.Layer<
  TrialIndex,
  IndexError,
  ArtifactStore | FileSystem.FileSystem | Path.Path
> = Layer.scoped(
  TrialIndex,
  Effect.gen(function* () {
    const store = yield* ArtifactStore;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dbPath = path.join(store.root, 'index.db');

    yield* fs
      .makeDirectory(path.dirname(dbPath), { recursive: true })
      .pipe(Effect.mapError(failWith('open')));
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const instance = new Database(dbPath);
          instance.pragma('journal_mode = WAL');
          instance.exec(SCHEMA_SQL);
          return instance;
        },
        catch: failWith('open'),
      }),
      (instance) => Effect.sync(() => instance.close()),
    );

    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO trials
         (trial_id, run_id, scenario_id, condition_label, model_id, harness, shape, outcome, started_at, ended_at)
       VALUES (@trialId, @runId, @scenarioId, @conditionLabel, @modelId, @harness, @shape, @outcome, @startedAt, @endedAt)`,
    );
    const upsertRunStmt = db.prepare(
      `INSERT OR REPLACE INTO runs (run_id, validity) VALUES (@runId, @validity)`,
    );
    // One transaction per bulk rebuild: without it better-sqlite3 auto-commits
    // (and fsyncs) every row, which makes reindexing a large store crawl.
    const replaceAll = db.transaction((rows: ReadonlyArray<TrialRow>) => {
      db.exec('DELETE FROM trials');
      for (const row of rows) insertStmt.run(row);
    });

    const insertTrial: TrialIndexShape['insertTrial'] = (trial) =>
      Effect.try({
        try: () => void insertStmt.run(rowOf(trial)),
        catch: failWith('insertTrial'),
      });

    const upsertValidity: TrialIndexShape['upsertValidity'] = (runId, validity) =>
      Effect.try({
        try: () => void upsertRunStmt.run({ runId, validity }),
        catch: failWith('upsertValidity'),
      });

    const reindex: TrialIndexShape['reindex'] = Effect.gen(function* () {
      // Rebuild runs table first — validity is per run, and cell summaries
      // derive it by joining through trials.
      const runIds = yield* store.listRunIds.pipe(Effect.mapError(failWith('reindex:scan')));
      const runs = yield* Effect.forEach(
        runIds,
        (runId) => store.readRun(runId).pipe(Effect.option),
        { concurrency: 16 },
      );
      yield* Effect.try({
        try: () => {
          db.exec('DELETE FROM runs');
          for (const run of runs) {
            if (Option.isSome(run)) {
              upsertRunStmt.run({ runId: run.value.runId, validity: run.value.validity ?? null });
            }
          }
        },
        catch: failWith('reindex:runs'),
      });

      const trials = yield* store.listAllTrials.pipe(Effect.mapError(failWith('reindex:scan')));
      yield* Effect.try({
        try: () => void replaceAll(trials.map(rowOf)),
        catch: failWith('reindex:rebuild'),
      });
    });

    // Statements are cached per WHERE-clause shape — one entry per subset of
    // the three filterable columns (scenario, shape, harness), eight at most.
    const summaryStmts = new Map<string, Database.Statement>();
    const summaryStmt = (clauses: ReadonlyArray<string>) => {
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      let stmt = summaryStmts.get(where);
      if (stmt === undefined) {
        stmt = db.prepare(
          `SELECT t.scenario_id, t.condition_label, t.model_id, t.harness, t.shape,
                  SUM(CASE WHEN t.outcome = 'pass' THEN 1 ELSE 0 END) AS pass,
                  SUM(CASE WHEN t.outcome = 'fail' THEN 1 ELSE 0 END) AS fail,
                  SUM(CASE WHEN t.outcome = 'inconclusive' THEN 1 ELSE 0 END) AS inconclusive,
                  SUM(CASE WHEN t.outcome = 'error' THEN 1 ELSE 0 END) AS error,
                  COUNT(*) AS trials,
                  MAX(r.validity) AS validity
           FROM trials t
           LEFT JOIN runs r ON t.run_id = r.run_id
           ${where}
           GROUP BY t.scenario_id, t.condition_label, t.model_id, t.harness, t.shape
           ORDER BY t.scenario_id, t.condition_label, t.model_id, t.harness, t.shape`,
        );
        summaryStmts.set(where, stmt);
      }
      return stmt;
    };

    const cellSummaries: TrialIndexShape['cellSummaries'] = (filter) =>
      Effect.try({
        try: () => {
          const clauses: Array<string> = [];
          const params: Record<string, string> = {};
          if (filter?.scenarioId !== undefined) {
            clauses.push('scenario_id = @scenarioId');
            params.scenarioId = filter.scenarioId;
          }
          if (filter?.shape !== undefined) {
            clauses.push('shape = @shape');
            params.shape = filter.shape;
          }
          if (filter?.harness !== undefined) {
            clauses.push('harness = @harness');
            params.harness = filter.harness;
          }
          const rows = summaryStmt(clauses).all(params) as ReadonlyArray<CellRow>;
          return rows.map((row): CellSummary => ({
            scenarioId: row.scenario_id,
            condition: row.condition_label,
            modelId: row.model_id,
            harness: row.harness,
            shape: row.shape,
            trials: row.trials,
            pass: row.pass,
            fail: row.fail,
            inconclusive: row.inconclusive,
            error: row.error,
            failRate: row.pass + row.fail > 0 ? row.fail / (row.pass + row.fail) : null,
            validity: (row.validity ?? undefined) as CellSummary['validity'],
          }));
        },
        catch: failWith('cellSummaries'),
      });

    return TrialIndex.of({ reindex, insertTrial, upsertValidity, cellSummaries });
  }),
);
