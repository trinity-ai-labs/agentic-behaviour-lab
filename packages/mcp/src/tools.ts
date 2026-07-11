/**
 * MCP tool definitions bridging agents into the lab. The zod input schemas
 * advertise each tool's shape to MCP clients; the engine's Effect schemas
 * remain the authoritative contract, so `lab_run` re-decodes its payload
 * with the engine's `RunConfig` before anything runs. Long batches are
 * forked onto daemon fibers — a tool call never blocks on a fleet; clients
 * get a runId back immediately and poll `lab_run_status`.
 */
import {
  ExecutionShape,
  RunConfig,
  type ArtifactStore,
  type IndexError,
  type Runner,
  type ScenarioRepo,
  type TrialIndex,
} from '@abl/engine';
import type { FileSystem, Path } from '@effect/platform';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Cause, Effect, Exit, Option, Schema, type ManagedRuntime } from 'effect';
import { z } from 'zod';
import * as Lab from './lab.js';

/** Everything a tool handler may reach for; `main.ts` and the tests both provide it (engine + platform services). */
export type LabServices =
  Runner | ArtifactStore | ScenarioRepo | TrialIndex | FileSystem.FileSystem | Path.Path;

export type LabRuntime = ManagedRuntime.ManagedRuntime<LabServices, IndexError>;

const decodeRunConfig = Schema.decodeUnknown(RunConfig);

type ToolResult = CallToolResult;

const jsonResult = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

const errorResult = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/**
 * Expected failures come out of the error channel as tagged values; their
 * fields (not their usually-empty `message`) carry the story, so they are
 * serialized. Defects and interruptions fall back to the pretty cause.
 */
const describeCause = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.failureOption(cause);
  if (Option.isNone(failure)) return Cause.pretty(cause);
  const error = failure.value;
  if (error instanceof Error && error.message !== '') return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

/** Never rejects: failures become `isError` results the calling agent can read and react to. */
const runTool = <A>(
  runtime: LabRuntime,
  effect: Effect.Effect<A, unknown, LabServices>,
): Promise<ToolResult> =>
  runtime
    .runPromiseExit(effect)
    .then((exit) =>
      Exit.isSuccess(exit) ? jsonResult(exit.value) : errorResult(describeCause(exit.cause)),
    );

// The enum is built from the engine's own literal list so the advertised
// shape cannot drift from the contract.
const shapeEnum = z.enum(ExecutionShape.literals as unknown as [string, ...Array<string>]);

export const makeLabServer = (runtime: LabRuntime): McpServer => {
  const server = new McpServer(
    { name: 'agentic-behaviour-lab', version: '0.1.0' },
    {
      instructions:
        "Tools for the Agentic Behaviour Lab. lab_run returns {runId} immediately while trials execute in the background: poll lab_run_status until the run leaves 'running', then read lab_results (cell summaries) and lab_get_trial (one record + artifacts).",
    },
  );

  const registry = Lab.makeRunRegistry();

  server.registerTool(
    'lab_list_scenarios',
    {
      title: 'List scenarios',
      description:
        'Lists every scenario visible to the lab: id, version, title, family, description, declared condition cells, and the execution shapes it supports.',
    },
    () => runTool(runtime, Lab.listScenarios),
  );

  server.registerTool(
    'lab_run',
    {
      title: 'Launch a benchmark run',
      description:
        'Starts a batch: one scenario fanned across conditions x models x harnesses, N trials per (condition x model x harness) cell. Returns {runId} immediately — the batch runs in the background; poll lab_run_status.',
      inputSchema: {
        scenarioId: z.string().describe('Scenario id (see lab_list_scenarios)'),
        conditions: z.array(z.string()).describe('Condition labels declared by the scenario'),
        models: z.array(z.string()).describe('Model ids to compare'),
        harnesses: z
          .array(z.string())
          .optional()
          .describe(
            'Harness ids to compare: "claude-cli" and/or "codex-cli" (default ["claude-cli"])',
          ),
        shape: shapeEnum.describe('Execution shape to run under'),
        trialsPerCell: z
          .number()
          .int()
          .min(1)
          .describe('Trials per condition x model x harness cell'),
        maxConcurrent: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Cap on concurrently running trials (default 4)'),
      },
    },
    (args) => runTool(runtime, decodeRunConfig(args).pipe(Effect.flatMap(registry.launchRun))),
  );

  server.registerTool(
    'lab_run_status',
    {
      title: 'Poll a run',
      description:
        "A run's record plus derived progress: planned vs completed trial counts, per-cell summaries, and per-trial outcomes (the trialIds for lab_get_trial). Status 'completed' means every trial is graded and persisted.",
      inputSchema: {
        runId: z.string().describe('The runId returned by lab_run'),
      },
    },
    ({ runId }) => runTool(runtime, registry.runStatus(runId)),
  );

  server.registerTool(
    'lab_results',
    {
      title: 'Query cell summaries',
      description:
        'Aggregated outcome counts per (scenario, condition, model, harness, shape) cell — the model/harness-comparison payload. All filters optional; failRate is fail/(pass+fail), null until graded trials exist.',
      inputSchema: {
        scenarioId: z.string().optional(),
        runId: z
          .string()
          .optional()
          .describe('Restrict to one run (aggregated from its trial files)'),
        models: z.array(z.string()).optional(),
        conditions: z.array(z.string()).optional(),
        harnesses: z
          .array(z.string())
          .optional()
          .describe(
            'Fingerprint harness strings as reported in cells, e.g. "claude-code/2.1.206 (headless -p)"',
          ),
      },
    },
    (args) => runTool(runtime, Lab.results(args)),
  );

  server.registerTool(
    'lab_get_trial',
    {
      title: 'Fetch one trial',
      description:
        'The full trial record (verdict, fingerprint, condition) plus its artifact files inlined — final message, state log — each truncated past 16KiB.',
      inputSchema: {
        trialId: z.string(),
        runId: z.string().optional().describe('Skips the cross-run scan when known'),
      },
    },
    ({ trialId, runId }) => runTool(runtime, Lab.getTrial(trialId, runId)),
  );

  return server;
};
