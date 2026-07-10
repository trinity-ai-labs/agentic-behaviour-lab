// Drives the MCP server exactly as an agent would, over the SDK's linked
// in-memory transport pair: discover scenarios, launch a batch, poll it to
// completion, then read cell summaries and a single trial back out.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { CellSummary } from "@abl/engine"
import { makeLabServer } from "../src/tools.js"
import type { InlinedArtifact, RunStatus, TrialDetail } from "../src/lab.js"
import { makeTestLab, type TestLab } from "./support.js"

interface TextContent {
  readonly type: string
  readonly text: string
}

interface ScenarioListing {
  readonly scenarioId: string
  readonly title: string
  readonly family: string
  readonly conditions: ReadonlyArray<{ readonly label: string }>
  readonly declaredShapes: ReadonlyArray<string>
}

const firstText = (result: Awaited<ReturnType<Client["callTool"]>>): string => {
  const [first] = result.content as Array<TextContent>
  expect(first?.type).toBe("text")
  return first!.text
}

describe("@abl/mcp server", () => {
  let lab: TestLab
  let server: ReturnType<typeof makeLabServer>
  let client: Client

  const callJson = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError ?? false).toBe(false)
    return JSON.parse(firstText(result)) as T
  }

  beforeAll(async () => {
    lab = makeTestLab()
    server = makeLabServer(lab.runtime)
    client = new Client({ name: "abl-mcp-test", version: "0.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  afterAll(async () => {
    await client.close()
    await server.close()
    await lab.dispose()
  })

  it("lists scenarios with conditions and declared shapes", async () => {
    const scenarios = await callJson<Array<ScenarioListing>>("lab_list_scenarios")
    const scenario = scenarios.find((entry) => entry.scenarioId === "mcp-min")
    expect(scenario).toBeDefined()
    expect(scenario!.family).toBe("test-fixture")
    expect(scenario!.conditions.map((condition) => condition.label)).toEqual(["default"])
    expect(scenario!.declaredShapes).toEqual(["one-shot"])
  })

  it(
    "runs a batch fire-and-poll and serves results and trial details",
    async () => {
      const { runId } = await callJson<{ runId: string }>("lab_run", {
        scenarioId: "mcp-min",
        conditions: ["default"],
        models: ["stub-complete", "stub-partial"],
        shape: "one-shot",
        trialsPerCell: 1,
      })
      expect(runId).toMatch(/^[0-9a-f-]{36}$/)

      const deadline = Date.now() + 30_000
      let status = await callJson<RunStatus>("lab_run_status", { runId })
      while (status.run.status === "running") {
        expect(Date.now()).toBeLessThan(deadline)
        await new Promise((resolve) => setTimeout(resolve, 100))
        status = await callJson<RunStatus>("lab_run_status", { runId })
      }

      expect(status.run.status).toBe("completed")
      expect(status.batchError).toBeUndefined()
      expect(status.plannedTrials).toBe(2)
      expect(status.completedTrials).toBe(2)
      expect(status.cells).toHaveLength(2)
      expect(status.trials).toHaveLength(2)

      const results = await callJson<Array<CellSummary>>("lab_results", { scenarioId: "mcp-min", runId })
      expect(results).toHaveLength(2)
      const byModel = new Map(results.map((cell) => [cell.modelId, cell]))
      expect(byModel.get("stub-complete")).toMatchObject({ trials: 1, pass: 1, fail: 0, failRate: 0 })
      expect(byModel.get("stub-partial")).toMatchObject({ trials: 1, pass: 0, fail: 1, failRate: 1 })

      // The same cells through the index-backed (no runId) path, filtered.
      const indexed = await callJson<Array<CellSummary>>("lab_results", { models: ["stub-complete"] })
      expect(indexed).toHaveLength(1)
      expect(indexed[0]).toMatchObject({ scenarioId: "mcp-min", modelId: "stub-complete", pass: 1 })

      const passTrial = status.trials.find((trial) => trial.modelId === "stub-complete")
      expect(passTrial?.outcome).toBe("pass")
      const detail = await callJson<TrialDetail>("lab_get_trial", { trialId: passTrial!.trialId })
      expect(detail.trial.runId).toBe(runId)
      expect(detail.trial.fingerprint.modelId).toBe("stub-complete")
      expect(detail.trial.fingerprint.harness).toBe("stub-adapter/1")
      const finalMessage = detail.artifacts["finalMessage"] as InlinedArtifact
      expect(finalMessage.content).toContain("marker chain")
      expect(finalMessage.truncated).toBe(false)
    },
    60_000,
  )

  it("surfaces an unknown scenario as an isError result, not a hang", async () => {
    const result = await client.callTool({
      name: "lab_run",
      arguments: {
        scenarioId: "no-such-scenario",
        conditions: ["default"],
        models: ["stub-complete"],
        shape: "one-shot",
        trialsPerCell: 1,
      },
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("no-such-scenario")
  })

  it("surfaces an unknown trial as an isError result", async () => {
    const result = await client.callTool({
      name: "lab_get_trial",
      arguments: { trialId: "does-not-exist" },
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("does-not-exist")
  })
})
