// The whole product surface over real HTTP: a stub-backed engine served on
// an ephemeral 127.0.0.1 port (NodeHttpServer.layerTest), exercised through
// the client derived from the same AblApi contract the server implements.
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { HttpApiBuilder, HttpApiClient } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { EngineLive, StubAdapterLive } from "@abl/engine"
import { Effect, Layer } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AblApi, ApiLive } from "../src/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesRoot = path.join(__dirname, "fixtures")
const subjectsDir = path.join(fixturesRoot, "scenario-min", "subjects")

const serverLayer = (ablHome: string) =>
  HttpApiBuilder.serve().pipe(
    Layer.provide(ApiLive),
    Layer.provide(
      EngineLive({
        ablHome,
        scenarioRoots: [fixturesRoot],
        adapters: {
          "claude-cli": StubAdapterLive({
            "stub-complete": path.join(subjectsDir, "complete.mjs"),
            "stub-partial": path.join(subjectsDir, "partial.mjs"),
          }),
        },
      }),
    ),
    // layerTest binds a real Node server to an ephemeral 127.0.0.1 port and
    // provides an HttpClient already pointed at it (plus NodeContext for the
    // engine's FileSystem/Path/CommandExecutor needs).
    Layer.provideMerge(NodeHttpServer.layerTest),
  )

describe("@abl/server HTTP API", () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "abl-server-test-"))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  // it.live, not it.effect: the test spans real HTTP and real subprocesses,
  // and the poll's Effect.delay must tick on the wall clock — under
  // it.effect's frozen TestClock it would never fire.
  it.live(
    "drives the full run lifecycle: scenarios, POST run, poll, trials, results, reindex",
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(AblApi)

        // The scenario library is visible before any run exists.
        const scenarios = yield* client.scenarios.list()
        expect(scenarios.map((scenario) => scenario.scenarioId)).toContain("scenario-min")

        // No runs yet.
        expect(yield* client.runs.list()).toHaveLength(0)

        // A config referencing an unknown condition is rejected before anything forks.
        const rejected = yield* client.runs
          .create({
            payload: {
              scenarioId: "scenario-min",
              conditions: ["does-not-exist"],
              models: ["stub-complete"],
              harnesses: ["claude-cli"],
              shape: "one-shot",
              trialsPerCell: 1,
              maxConcurrent: 1,
            },
          })
          .pipe(Effect.flip)
        expect(rejected._tag).toBe("RunRejected")

        const unknownScenario = yield* client.runs
          .create({
            payload: {
              scenarioId: "no-such-scenario",
              conditions: ["default"],
              models: ["stub-complete"],
              harnesses: ["claude-cli"],
              shape: "one-shot",
              trialsPerCell: 1,
              maxConcurrent: 1,
            },
          })
          .pipe(Effect.flip)
        expect(unknownScenario._tag).toBe("ScenarioNotFound")

        // POST returns the runId as soon as the batch is forked...
        const { runId } = yield* client.runs.create({
          payload: {
            scenarioId: "scenario-min",
            conditions: ["default"],
            models: ["stub-complete", "stub-partial"],
            harnesses: ["claude-cli"],
            shape: "one-shot",
            trialsPerCell: 2,
            maxConcurrent: 2,
          },
        })

        // ...and the run is followed by polling until it leaves "running".
        const detail = yield* client.runs
          .get({ path: { runId } })
          .pipe(
            Effect.delay("50 millis"),
            Effect.repeat({ until: (d) => d.run.status !== "running" }),
          )
        expect(detail.run.status).toBe("completed")

        // Per-cell progress: 1 condition x 2 models, 2 trials each.
        expect(detail.cells).toHaveLength(2)
        const passCell = detail.cells.find((cell) => cell.modelId === "stub-complete")
        const failCell = detail.cells.find((cell) => cell.modelId === "stub-partial")
        expect(passCell).toMatchObject({ expectedTrials: 2, pass: 2, fail: 0 })
        expect(failCell).toMatchObject({ expectedTrials: 2, pass: 0, fail: 2 })
        expect(passCell!.trialIds).toHaveLength(2)

        const runs = yield* client.runs.list()
        expect(runs.map((run) => run.runId)).toContain(runId)

        // Trial detail by bare trialId, with the small final-message artifact inlined.
        const trialId = passCell!.trialIds[0]!
        const trialDetail = yield* client.trials.get({ path: { trialId } })
        expect(trialDetail.trial.runId).toBe(runId)
        expect(trialDetail.trial.verdict.outcome).toBe("pass")
        expect(trialDetail.inlined["finalMessage"]).toContain("marker chain")

        // Aggregates from the derived index, with query-param narrowing.
        const allCells = yield* client.results.list({ urlParams: {} })
        expect(allCells).toHaveLength(2)
        const onlyComplete = yield* client.results.list({
          urlParams: { scenarioId: "scenario-min", model: "stub-complete" },
        })
        expect(onlyComplete).toHaveLength(1)
        expect(onlyComplete[0]).toMatchObject({ trials: 2, pass: 2, failRate: 0 })

        // Rebuilding the index from flat files reproduces identical results.
        yield* client.results.reindex()
        expect(yield* client.results.list({ urlParams: {} })).toEqual(allCells)

        // Missing resources answer 404 as their tagged wire errors.
        const noRun = yield* client.runs.get({ path: { runId: "no-such-run" } }).pipe(Effect.flip)
        expect(noRun._tag).toBe("RunNotFound")
        const noTrial = yield* client.trials.get({ path: { trialId: "no-such-trial" } }).pipe(Effect.flip)
        expect(noTrial._tag).toBe("TrialNotFound")
      }).pipe(Effect.provide(serverLayer(home))),
    30_000,
  )
})
