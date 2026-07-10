import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { ArtifactStore, ArtifactStoreLive } from "../src/index.js"
import { cleanupTempHome, makeTempHome, makeTrial } from "./support.js"

describe("ArtifactStore", () => {
  let home: string
  let TestLive: Layer.Layer<ArtifactStore>

  beforeEach(() => {
    home = makeTempHome()
    TestLive = ArtifactStoreLive(home).pipe(Layer.provide(NodeContext.layer))
  })

  afterEach(() => {
    cleanupTempHome(home)
  })

  it.effect("round-trips a run record", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const run = {
        runId: "run-1",
        config: {
          scenarioId: "scenario-min",
          conditions: ["default"],
          models: ["stub-complete"],
          shape: "one-shot" as const,
          trialsPerCell: 1,
          maxConcurrent: 4,
        },
        startedAt: new Date().toISOString(),
        status: "running" as const,
      }

      yield* store.writeRun(run)
      const read = yield* store.readRun("run-1")
      expect(read).toEqual(run)

      const runIds = yield* store.listRunIds
      expect(runIds).toContain("run-1")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("round-trips a trial record and lists it", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const trial = makeTrial({
        trialId: "trial-1",
        condition: { label: "default", params: { style: "sequentially" } },
      })

      yield* store.writeTrial(trial)
      const read = yield* store.readTrial("run-1", "trial-1")
      expect(read).toEqual(trial)

      const trialIds = yield* store.listTrialIds("run-1")
      expect(trialIds).toEqual(["trial-1"])

      const all = yield* store.listAllTrials
      expect(all).toEqual([trial])
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("writes an artifact beside the trial directory", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      yield* store.writeArtifact("run-1", "trial-1", "final-message.txt", "hello")
      const dir = store.trialDir("run-1", "trial-1")
      expect(dir.endsWith(`run-1/trial-1`)).toBe(true)
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("creates and removes a trial workspace", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const fs = yield* FileSystem.FileSystem
      const dir = yield* store.makeWorkspace("run-1", "trial-1")
      expect(yield* fs.exists(dir)).toBe(true)
      yield* store.removeWorkspace("run-1", "trial-1")
      expect(yield* fs.exists(dir)).toBe(false)
    }).pipe(Effect.provide(Layer.mergeAll(TestLive, NodeContext.layer))),
  )

  it.effect("fails readRun with StoreError for a run that was never written", () =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const result = yield* Effect.either(store.readRun("does-not-exist"))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("StoreError")
      }
    }).pipe(Effect.provide(TestLive)),
  )
})
