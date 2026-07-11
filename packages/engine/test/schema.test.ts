import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { RunConfig } from "../src/index.js"

describe("RunConfig", () => {
  it("decodes a payload without harnesses to the claude-cli default", () => {
    const decoded = Schema.decodeUnknownSync(RunConfig)({
      scenarioId: "scenario-min",
      conditions: ["default"],
      models: ["stub-complete"],
      shape: "one-shot",
      trialsPerCell: 1,
    })
    expect(decoded.harnesses).toEqual(["claude-cli"])
  })

  it("decodes an explicit harnesses array unchanged", () => {
    const decoded = Schema.decodeUnknownSync(RunConfig)({
      scenarioId: "scenario-min",
      conditions: ["default"],
      models: ["stub-complete"],
      harnesses: ["claude-cli", "codex-cli"],
      shape: "one-shot",
      trialsPerCell: 1,
    })
    expect(decoded.harnesses).toEqual(["claude-cli", "codex-cli"])
  })
})
