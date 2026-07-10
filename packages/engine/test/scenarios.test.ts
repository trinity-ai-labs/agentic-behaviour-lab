import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { ScenarioRepo, ScenarioRepoLive, renderBrief } from "../src/index.js"
import { fixturesRoot } from "./support.js"

const TestLive = ScenarioRepoLive([fixturesRoot]).pipe(Layer.provide(NodeContext.layer))

describe("ScenarioRepo", () => {
  it.effect("loads scenario-min with fingerprint-ready content hashes", () =>
    Effect.gen(function* () {
      const scenarios = yield* ScenarioRepo
      const scenario = yield* scenarios.load("scenario-min")

      expect(scenario.definition.scenarioId).toBe("scenario-min")
      expect(scenario.definition.conditions).toHaveLength(1)
      expect(scenario.scenarioVersion).toMatch(/^[0-9a-f]{64}$/)
      expect(scenario.graderVersion).toMatch(/^[0-9a-f]{64}$/)
      expect(scenario.briefTemplate).toContain("{{style}}")
      expect(scenario.fixturePath.endsWith("fixture.mjs")).toBe(true)
      expect(scenario.graderPath.endsWith("grader.mjs")).toBe(true)
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("fails with ScenarioNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const scenarios = yield* ScenarioRepo
      const result = yield* Effect.either(scenarios.load("does-not-exist"))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ScenarioNotFound")
      }
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("lists every scenario under the configured roots", () =>
    Effect.gen(function* () {
      const scenarios = yield* ScenarioRepo
      const all = yield* scenarios.list
      expect(all.map((s) => s.scenarioId)).toContain("scenario-min")
    }).pipe(Effect.provide(TestLive)),
  )
})

describe("renderBrief", () => {
  it("substitutes known params", () => {
    const out = renderBrief("Work {{style}} through it.", { style: "carefully" })
    expect(out).toBe("Work carefully through it.")
  })

  it("leaves unknown placeholders untouched", () => {
    const out = renderBrief("Work {{style}} with {{missing}}.", { style: "carefully" })
    expect(out).toBe("Work carefully with {{missing}}.")
  })
})
