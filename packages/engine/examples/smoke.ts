/**
 * End-to-end smoke run against the StubAdapter: executes a small batch of
 * the test fixture scenario (all four subject variants, so all four verdict
 * outcomes appear), then prints the resulting cell summary table. No real
 * agent is spawned and nothing outside a throwaway temp ABL_HOME is touched.
 *
 *   pnpm --filter @abl/engine smoke
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { Runner, TrialIndex } from "../src/index.js"
import { cleanupTempHome, makeTempHome, stubEngine } from "../test/support.js"

const ablHome = makeTempHome()

const program = Effect.gen(function* () {
  const runner = yield* Runner
  const index = yield* TrialIndex

  yield* Effect.log(`smoke ABL_HOME: ${ablHome}`)

  const run = yield* runner.runBatch({
    scenarioId: "scenario-min",
    conditions: ["default"],
    models: ["stub-complete", "stub-partial", "stub-poison", "stub-noop"],
    harnesses: ["claude-cli"],
    shape: "one-shot",
    trialsPerCell: 2,
    maxConcurrent: 4,
  })

  yield* Effect.log(`run ${run.runId} ${run.status} (${run.startedAt} -> ${run.endedAt})`)

  const summaries = yield* index.cellSummaries()
  console.table(
    summaries.map((cell) => ({
      scenario: cell.scenarioId,
      condition: cell.condition,
      model: cell.modelId,
      shape: cell.shape,
      trials: cell.trials,
      pass: cell.pass,
      fail: cell.fail,
      inconclusive: cell.inconclusive,
      error: cell.error,
      failRate: cell.failRate,
    })),
  )
}).pipe(Effect.ensuring(Effect.sync(() => cleanupTempHome(ablHome))))

NodeRuntime.runMain(program.pipe(Effect.provide(stubEngine(ablHome))))
