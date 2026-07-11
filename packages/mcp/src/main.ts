#!/usr/bin/env node
/**
 * `abl-mcp` entrypoint: one ManagedRuntime carrying the composed engine
 * (real Claude Code + Codex CLI adapters) is built at startup and shared by
 * every tool handler; the MCP server speaks the stdio transport. stdout
 * belongs to the protocol, so all Effect logging is rerouted to stderr — a
 * single stray stdout line would corrupt the JSON-RPC stream.
 */
import { cliAdapters, defaultAblHome, EngineLive } from '@abl/engine';
import { NodeContext } from '@effect/platform-node';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Layer, Logger, ManagedRuntime } from 'effect';
import { resolveScenarioRoots } from './config.js';
import { makeLabServer } from './tools.js';

const ablHome = defaultAblHome();
const scenarioRoots = resolveScenarioRoots(process.env.ABL_SCENARIO_ROOTS, process.cwd(), ablHome);

const runtime = ManagedRuntime.make(
  EngineLive({ ablHome, scenarioRoots, adapters: cliAdapters }).pipe(
    Layer.provideMerge(NodeContext.layer),
    Layer.merge(
      Logger.replace(Logger.defaultLogger, Logger.prettyLogger({ stderr: true, colors: false })),
    ),
  ),
);

const server = makeLabServer(runtime);

const shutdown = (): void => {
  void (async () => {
    await server.close().catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
    process.exit(0);
  })();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await server.connect(new StdioServerTransport());
// The client hanging up (stdin closing) is the normal end of a session:
// release the runtime — interrupting any still-running batch fibers — and
// exit instead of lingering as an orphan.
server.server.onclose = shutdown;
