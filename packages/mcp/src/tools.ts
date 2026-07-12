/**
 * MCP tool definitions bridging agents into the lab. The JSON Schema input
 * schemas are generated FROM the engine's Effect schemas via
 * `effect/JSONSchema.make` so they accurately advertise each tool's shape
 * to MCP clients; validation is delegated to `Schema.decodeUnknown` before
 * any handler runs. Long batches are forked onto daemon fibers — a tool call
 * never blocks on a fleet; clients get a runId back immediately and poll
 * `lab_run_status`.
 */
import {
  RunConfig,
  type ArtifactStore,
  type IndexError,
  type KeyStore,
  type KeyStoreError,
  type Runner,
  type ScenarioRepo,
  type TrialIndex,
} from '@abl/engine';
import type { FileSystem, Path } from '@effect/platform';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Cause, Effect, Exit, Option, Schema, type ManagedRuntime } from 'effect';
import { make } from 'effect/JSONSchema';
import * as Lab from './lab.js';

/** Everything a tool handler may reach for; `main.ts` and the tests both provide it (engine + platform services). */
export type LabServices =
  Runner | ArtifactStore | ScenarioRepo | TrialIndex | KeyStore | FileSystem.FileSystem | Path.Path;

export type LabRuntime = ManagedRuntime.ManagedRuntime<LabServices, IndexError | KeyStoreError>;

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

// ---------------------------------------------------------------------------
// Effect schemas for tool input params — used to generate JSON Schema for
// MCP advertisement AND to validate incoming call args at runtime.
// ---------------------------------------------------------------------------

const RunStatusParams = Schema.Struct({ runId: Schema.String });

const ResultsParams = Schema.Struct({
  scenarioId: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  models: Schema.optional(Schema.Array(Schema.String)),
  conditions: Schema.optional(Schema.Array(Schema.String)),
  harnesses: Schema.optional(Schema.Array(Schema.String)),
});

const TrialParams = Schema.Struct({
  trialId: Schema.String,
  runId: Schema.optional(Schema.String),
});

const decodeRunStatusParams = Schema.decodeUnknown(RunStatusParams);
const decodeResultsParams = Schema.decodeUnknown(ResultsParams);
const decodeTrialParams = Schema.decodeUnknown(TrialParams);

// Generate JSON Schema from the engine's own Effect schemas once, so the
// advertised shape stays synchronised with the authoritative contract.
const runConfigSchema = make(RunConfig) as unknown as Record<string, unknown>;
const runStatusSchema = make(RunStatusParams) as unknown as Record<string, unknown>;
const resultsSchema = make(ResultsParams) as unknown as Record<string, unknown>;
const trialSchema = make(TrialParams) as unknown as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export const makeLabServer = (runtime: LabRuntime): Server => {
  const server = new Server(
    { name: 'agentic-behaviour-lab', version: '0.1.0' },
    {
      // No dynamic tool registration — the tool list is static, so we
      // never send notifications/tools/list_changed. A plain tools: {}
      // capability is enough to advertise the ListTools / CallTool handlers.
      capabilities: { tools: {} },
      instructions:
        "Tools for the Agentic Behaviour Lab. lab_run returns {runId} immediately while trials execute in the background: poll lab_run_status until the run leaves 'running', then read lab_results (cell summaries) and lab_get_trial (one record + artifacts).",
    },
  );

  const registry = Lab.makeRunRegistry();

  // Each entry carries the metadata for tools/list and the handler for
  // tools/call, keeping registration and routing together.
  const toolDefinitions: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  }> = [
    {
      name: 'lab_list_models',
      title: 'List model catalog',
      description:
        'Lists every model in the catalog grouped by provider. Each model has a compound id (provider:model), a human-readable label, and an intelligence level (1-4).',
      inputSchema: { type: 'object', properties: {} },
      handler: () => runTool(runtime, Lab.listModels),
    },
    {
      name: 'lab_list_scenarios',
      title: 'List scenarios',
      description:
        'Lists every scenario visible to the lab: id, version, title, family, description, declared condition cells, and the execution shapes it supports.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => runTool(runtime, Lab.listScenarios),
    },
    {
      name: 'lab_run',
      title: 'Launch a benchmark run',
      description:
        'Starts a batch: one scenario fanned across conditions x models x harnesses, N trials per (condition x model x harness) cell. Returns {runId} immediately — the batch runs in the background; poll lab_run_status.',
      inputSchema: runConfigSchema,
      handler: (args) =>
        runTool(runtime, decodeRunConfig(args).pipe(Effect.flatMap(registry.launchRun))),
    },
    {
      name: 'lab_run_status',
      title: 'Poll a run',
      description:
        "A run's record plus derived progress: planned vs completed trial counts, per-cell summaries, and per-trial outcomes (the trialIds for lab_get_trial). Status 'completed' means every trial is graded and persisted.",
      inputSchema: runStatusSchema,
      handler: (args) =>
        runTool(
          runtime,
          decodeRunStatusParams(args).pipe(
            Effect.flatMap(({ runId }) => registry.runStatus(runId)),
          ),
        ),
    },
    {
      name: 'lab_results',
      title: 'Query cell summaries',
      description:
        'Aggregated outcome counts per (scenario, condition, model, harness, shape) cell — the model/harness-comparison payload. All filters optional; failRate is fail/(pass+fail), null until graded trials exist.',
      inputSchema: resultsSchema,
      handler: (args) =>
        runTool(runtime, decodeResultsParams(args).pipe(Effect.flatMap(Lab.results))),
    },
    {
      name: 'lab_get_trial',
      title: 'Fetch one trial',
      description:
        'The full trial record (verdict, fingerprint, condition) plus its artifact files inlined — final message, state log — each truncated past 16KiB.',
      inputSchema: trialSchema,
      handler: (args) =>
        runTool(
          runtime,
          decodeTrialParams(args).pipe(
            Effect.flatMap(({ trialId, runId }) => Lab.getTrial(trialId, runId)),
          ),
        ),
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map(({ handler: _, ...rest }) => rest),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolDefinitions.find((t) => t.name === name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`);
    }
    return tool.handler(args ?? {});
  });

  return server;
};
