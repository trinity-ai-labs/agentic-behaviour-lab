/**
 * Handler layers binding the wire contract (`api.ts`) to the engine services.
 * Expected failures travel as the wire errors; store/index failures become
 * defects (`orDie` → 500) because they mean the flat-file truth itself can no
 * longer be read — not something a client can act on.
 */
import { FileSystem, HttpApiBuilder, Path } from "@effect/platform"
import {
  ArtifactStore,
  ScenarioRepo,
  TrialIndex,
  type CellFilter,
  type TrialRecord,
  type VerdictOutcome,
} from "@abl/engine"
import { Effect, Layer, Option } from "effect"
import { AblApi, INLINE_ARTIFACT_LIMIT, RunNotFound, TrialNotFound, type CellProgress } from "./api.js"
import { launchRun } from "./run-launch.js"

const ScenariosLive = HttpApiBuilder.group(AblApi, "scenarios", (handlers) =>
  Effect.gen(function* () {
    const scenarios = yield* ScenarioRepo
    return handlers.handle("list", () => scenarios.list.pipe(Effect.orDie))
  }),
)

const RunsLive = HttpApiBuilder.group(AblApi, "runs", (handlers) =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore

    const list = store.listRunIds.pipe(
      Effect.flatMap((runIds) => Effect.forEach(runIds, store.readRun, { concurrency: 16 })),
      // Newest first — the order every consumer (dashboard, MCP) wants runs in.
      Effect.map((runs) => [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))),
      Effect.orDie,
    )

    const outcomeCount = (trials: ReadonlyArray<TrialRecord>, outcome: VerdictOutcome): number =>
      trials.filter((trial) => trial.verdict.outcome === outcome).length

    const get = (runId: string) =>
      Effect.gen(function* () {
        // Existence is judged by the run directory listing, so a corrupt
        // run.json still fails loudly (500) instead of masquerading as 404.
        const runIds = yield* store.listRunIds.pipe(Effect.orDie)
        if (!runIds.includes(runId)) {
          return yield* Effect.fail(new RunNotFound({ runId }))
        }
        const run = yield* store.readRun(runId).pipe(Effect.orDie)
        const trialIds = yield* store.listTrialIds(runId).pipe(Effect.orDie)
        const trials = yield* Effect.forEach(trialIds, (trialId) => store.readTrial(runId, trialId), {
          concurrency: 16,
        }).pipe(Effect.orDie)

        // Every promised cell appears, including ones with no trials yet, so
        // a client can render full progress from the first poll.
        const cells: Array<CellProgress> = run.config.conditions.flatMap((condition) =>
          run.config.models.map((modelId) => {
            const inCell = trials.filter(
              (trial) => trial.condition.label === condition && trial.fingerprint.modelId === modelId,
            )
            return {
              condition,
              modelId,
              // Trials from every requested harness land in this
              // (condition, model) cell, and the config promises
              // trialsPerCell for each one.
              expectedTrials: run.config.trialsPerCell * run.config.harnesses.length,
              trialIds: inCell.map((trial) => trial.trialId),
              pass: outcomeCount(inCell, "pass"),
              fail: outcomeCount(inCell, "fail"),
              inconclusive: outcomeCount(inCell, "inconclusive"),
              error: outcomeCount(inCell, "error"),
            }
          }),
        )

        return { run, cells }
      })

    return handlers
      .handle("create", ({ payload }) => launchRun(payload))
      .handle("list", () => list)
      .handle("get", ({ path }) => get(path.runId))
  }),
)

const ResultsLive = HttpApiBuilder.group(AblApi, "results", (handlers) =>
  Effect.gen(function* () {
    const index = yield* TrialIndex
    return handlers
      .handle("list", ({ urlParams }) => {
        // scenario/harness push down into the index query; model/condition
        // narrow the few returned cells in memory (the engine's CellFilter
        // has no such axes).
        const filter: CellFilter = { scenarioId: urlParams.scenarioId, harness: urlParams.harness }
        return index.cellSummaries(filter).pipe(
          Effect.map((cells) =>
            cells.filter(
              (cell) =>
                (urlParams.model === undefined || cell.modelId === urlParams.model) &&
                (urlParams.condition === undefined || cell.condition === urlParams.condition),
            ),
          ),
          Effect.orDie,
        )
      })
      .handle("reindex", () => index.reindex.pipe(Effect.orDie))
  }),
)

const TrialsLive = HttpApiBuilder.group(AblApi, "trials", (handlers) =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    /**
     * The store keys trials by (runId, trialId) but the endpoint takes only
     * the trialId (a UUID), so the owning run is found by scanning run
     * directories — linear in runs, fine at local-first scale. A direct
     * trialId lookup belongs on the index read-side (engine gap, noted in
     * the introducing PR).
     */
    const locate = (trialId: string) =>
      Effect.gen(function* () {
        const runIds = yield* store.listRunIds.pipe(Effect.orDie)
        const matches = yield* Effect.forEach(
          runIds,
          (runId) => store.listTrialIds(runId).pipe(Effect.map((ids) => (ids.includes(trialId) ? runId : undefined))),
          { concurrency: 8 },
        ).pipe(Effect.orDie)
        const runId = matches.find((match) => match !== undefined)
        if (runId === undefined) return yield* Effect.fail(new TrialNotFound({ trialId }))
        return runId
      })

    const get = (trialId: string) =>
      Effect.gen(function* () {
        const runId = yield* locate(trialId)
        const trial = yield* store.readTrial(runId, trialId).pipe(Effect.orDie)
        const trialDir = store.trialDir(runId, trialId)

        const entries = yield* Effect.forEach(
          Object.entries(trial.artifacts),
          ([name, relPath]) =>
            Effect.gen(function* () {
              const file = path.join(trialDir, relPath)
              const info = yield* fs.stat(file).pipe(Effect.option)
              const small =
                Option.isSome(info) && info.value.type === "File" && info.value.size <= BigInt(INLINE_ARTIFACT_LIMIT)
              if (!small) return undefined
              const content = yield* fs.readFileString(file).pipe(Effect.orDie)
              return [name, content] as const
            }),
          { concurrency: 8 },
        )

        return { trial, inlined: Object.fromEntries(entries.filter((entry) => entry !== undefined)) }
      })

    return handlers.handle("get", ({ path: params }) => get(params.trialId))
  }),
)

/** The whole API, ready to serve — requires the engine plus FileSystem/Path. */
export const ApiLive = HttpApiBuilder.api(AblApi).pipe(
  Layer.provide([ScenariosLive, RunsLive, ResultsLive, TrialsLive]),
)
