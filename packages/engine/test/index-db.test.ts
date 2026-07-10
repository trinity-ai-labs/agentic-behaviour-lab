import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { ArtifactStore, ArtifactStoreLive, TrialIndex, TrialIndexLive } from "../src/index.js"
import { cleanupTempHome, makeTempHome, makeTrial } from "./support.js"
import type { IndexError } from "../src/index.js"

describe("TrialIndex", () => {
  let home: string
  let TestLive: Layer.Layer<ArtifactStore | TrialIndex, IndexError>

  beforeEach(() => {
    home = makeTempHome()
    const artifactStoreLive = ArtifactStoreLive(home)
    TestLive = Layer.mergeAll(artifactStoreLive, TrialIndexLive.pipe(Layer.provide(artifactStoreLive))).pipe(
      Layer.provide(NodeContext.layer),
    )
  })

  afterEach(() => {
    cleanupTempHome(home)
  })

  it.effect("insertTrial then cellSummaries reflects the outcome counts", () =>
    Effect.gen(function* () {
      const index = yield* TrialIndex
      yield* index.insertTrial(makeTrial({ trialId: "t1", verdict: { outcome: "pass", gradedBy: "mechanical", detail: {} } }))
      yield* index.insertTrial(makeTrial({ trialId: "t2", verdict: { outcome: "fail", gradedBy: "mechanical", detail: {} } }))

      const summaries = yield* index.cellSummaries()
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).toMatchObject({
        scenarioId: "scenario-min",
        condition: "default",
        modelId: "stub-complete",
        trials: 2,
        pass: 1,
        fail: 1,
        failRate: 0.5,
      })
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("failRate is null with no pass/fail trials yet", () =>
    Effect.gen(function* () {
      const index = yield* TrialIndex
      yield* index.insertTrial(
        makeTrial({ trialId: "t1", verdict: { outcome: "inconclusive", gradedBy: "mechanical", detail: {} } }),
      )
      const summaries = yield* index.cellSummaries()
      expect(summaries[0]?.failRate).toBeNull()
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("reindex rebuilds from the flat-file store, ignoring stale index rows", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const index = yield* TrialIndex

      // A trial that exists only in the index (never written to disk) —
      // reindex must drop it, since flat files are the source of truth.
      yield* index.insertTrial(makeTrial({ trialId: "orphan" }))

      const onDisk = makeTrial({ trialId: "on-disk" })
      yield* store.writeTrial(onDisk)

      yield* index.reindex
      const summaries = yield* index.cellSummaries()
      expect(summaries).toHaveLength(1)
      expect(summaries[0]?.trials).toBe(1)
    }).pipe(Effect.provide(TestLive)),
  )
})
