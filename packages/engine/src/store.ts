/**
 * The flat-file artifact store — the source of truth. Every run and trial
 * lives as JSON under `<ABL_HOME>/store/runs/<runId>/...`; nothing here is
 * ever the derived side (that's `index-db.ts`). Reads and writes both go
 * through the schema so a corrupt or foreign file fails loudly instead of
 * silently propagating malformed data.
 */
import { FileSystem, Path } from '@effect/platform';
import { Context, Data, Effect, Layer, Schema } from 'effect';
import * as NodeOs from 'node:os';
import { RunRecord, TrialRecord } from './schema.js';

export class StoreError extends Data.TaggedError('StoreError')<{
  readonly operation: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

const RunRecordFromJson = Schema.parseJson(RunRecord);
const TrialRecordFromJson = Schema.parseJson(TrialRecord);

export interface ArtifactStoreShape {
  /** `<ABL_HOME>/store` — the root every path below is relative to. */
  readonly root: string;
  readonly writeRun: (run: RunRecord) => Effect.Effect<void, StoreError>;
  readonly readRun: (runId: string) => Effect.Effect<RunRecord, StoreError>;
  readonly listRunIds: Effect.Effect<ReadonlyArray<string>, StoreError>;
  readonly writeTrial: (trial: TrialRecord) => Effect.Effect<void, StoreError>;
  readonly readTrial: (runId: string, trialId: string) => Effect.Effect<TrialRecord, StoreError>;
  readonly listTrialIds: (runId: string) => Effect.Effect<ReadonlyArray<string>, StoreError>;
  /** Scans every run for its trials — what `reindex` rebuilds the SQLite index from. */
  readonly listAllTrials: Effect.Effect<ReadonlyArray<TrialRecord>, StoreError>;
  /** Writes an arbitrary artifact file beside a trial's `trial.json` (final message, state log, ...). */
  readonly writeArtifact: (
    runId: string,
    trialId: string,
    relPath: string,
    content: string,
  ) => Effect.Effect<void, StoreError>;
  /** Absolute path to a trial's artifact directory — passed to graders as `TRIAL_DIR`. */
  readonly trialDir: (runId: string, trialId: string) => string;
  /** Creates a trial's throwaway workspace directory and returns its absolute path. */
  readonly makeWorkspace: (runId: string, trialId: string) => Effect.Effect<string, StoreError>;
  /** Removes a trial's workspace — workspaces are never artifacts, always discarded after the trial. */
  readonly removeWorkspace: (runId: string, trialId: string) => Effect.Effect<void, StoreError>;
}

export class ArtifactStore extends Context.Tag('@abl/engine/ArtifactStore')<
  ArtifactStore,
  ArtifactStoreShape
>() {}

/** `$ABL_HOME`, defaulting to `~/.abl` — the lab is local-first, no server-side config to fall back to. */
export const defaultAblHome = (): string => {
  const fromEnv = process.env.ABL_HOME;
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : `${NodeOs.homedir()}/.abl`;
};

export const ArtifactStoreLive = (
  ablHome: string = defaultAblHome(),
): Layer.Layer<ArtifactStore, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(ablHome, 'store');
      const runsRoot = path.join(root, 'runs');

      const wrap =
        (operation: string, filePath: string) =>
        <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, StoreError> =>
          effect.pipe(
            Effect.mapError((cause) => new StoreError({ operation, path: filePath, cause })),
          );

      const writeJson = <A>(
        operation: string,
        file: string,
        codec: Schema.Schema<A, string>,
        value: A,
      ) =>
        wrap(
          operation,
          file,
        )(
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            yield* fs.writeFileString(file, yield* Schema.encode(codec)(value));
          }),
        );

      const readJson = <A>(operation: string, file: string, codec: Schema.Schema<A, string>) =>
        wrap(
          operation,
          file,
        )(fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknown(codec))));

      const runPath = (runId: string) => path.join(runsRoot, runId, 'run.json');
      const trialPathFor = (runId: string, trialId: string) =>
        path.join(runsRoot, runId, trialId, 'trial.json');
      const workspacePath = (runId: string, trialId: string) =>
        path.join(root, 'workspaces', runId, trialId);

      const writeRun: ArtifactStoreShape['writeRun'] = (run) =>
        writeJson('writeRun', runPath(run.runId), RunRecordFromJson, run);

      const readRun: ArtifactStoreShape['readRun'] = (runId) =>
        readJson('readRun', runPath(runId), RunRecordFromJson);

      const listRunIds: ArtifactStoreShape['listRunIds'] = wrap(
        'listRunIds',
        runsRoot,
      )(
        Effect.gen(function* () {
          if (!(yield* fs.exists(runsRoot))) return [];
          return yield* fs.readDirectory(runsRoot);
        }),
      );

      const writeTrial: ArtifactStoreShape['writeTrial'] = (trial) =>
        writeJson(
          'writeTrial',
          trialPathFor(trial.runId, trial.trialId),
          TrialRecordFromJson,
          trial,
        );

      const readTrial: ArtifactStoreShape['readTrial'] = (runId, trialId) =>
        readJson('readTrial', trialPathFor(runId, trialId), TrialRecordFromJson);

      const listTrialIds: ArtifactStoreShape['listTrialIds'] = (runId) => {
        const dir = path.join(runsRoot, runId);
        return wrap(
          'listTrialIds',
          dir,
        )(
          Effect.gen(function* () {
            if (!(yield* fs.exists(dir))) return [];
            const entries = yield* fs.readDirectory(dir);
            // A run directory holds `run.json` alongside one directory per
            // trial; probing `run.json/trial.json` raises ENOTDIR rather than
            // reporting absence, so any probe failure means "not a trial
            // directory".
            return yield* Effect.filter(
              entries,
              (entry) =>
                fs
                  .exists(path.join(dir, entry, 'trial.json'))
                  .pipe(Effect.orElseSucceed(() => false)),
              { concurrency: 16 },
            );
          }),
        );
      };

      const listAllTrials: ArtifactStoreShape['listAllTrials'] = Effect.gen(function* () {
        const runIds = yield* listRunIds;
        const perRun = yield* Effect.forEach(
          runIds,
          (runId) =>
            listTrialIds(runId).pipe(
              Effect.flatMap((trialIds) =>
                Effect.forEach(trialIds, (trialId) => readTrial(runId, trialId), {
                  concurrency: 16,
                }),
              ),
            ),
          { concurrency: 4 },
        );
        return perRun.flat();
      });

      const writeArtifact: ArtifactStoreShape['writeArtifact'] = (
        runId,
        trialId,
        relPath,
        content,
      ) => {
        const file = path.join(runsRoot, runId, trialId, relPath);
        return wrap(
          'writeArtifact',
          file,
        )(
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            yield* fs.writeFileString(file, content);
          }),
        );
      };

      const trialDir: ArtifactStoreShape['trialDir'] = (runId, trialId) =>
        path.join(runsRoot, runId, trialId);

      const makeWorkspace: ArtifactStoreShape['makeWorkspace'] = (runId, trialId) => {
        const dir = workspacePath(runId, trialId);
        return wrap(
          'makeWorkspace',
          dir,
        )(fs.makeDirectory(dir, { recursive: true }).pipe(Effect.as(dir)));
      };

      const removeWorkspace: ArtifactStoreShape['removeWorkspace'] = (runId, trialId) => {
        const dir = workspacePath(runId, trialId);
        return wrap('removeWorkspace', dir)(fs.remove(dir, { recursive: true, force: true }));
      };

      return ArtifactStore.of({
        root,
        writeRun,
        readRun,
        listRunIds,
        writeTrial,
        readTrial,
        listTrialIds,
        listAllTrials,
        writeArtifact,
        trialDir,
        makeWorkspace,
        removeWorkspace,
      });
    }),
  );
