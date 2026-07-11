#!/usr/bin/env node
/**
 * `abl-serve` — one URL for the whole lab: the typed API under `/api` plus
 * the dashboard (from `packages/web/dist`, once built). Wires the engine a
 * single time with the real Claude Code + Codex CLI adapters; trials started
 * over HTTP run in this process.
 */
import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { NodeContext, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { cliAdapters, defaultAblHome, EngineLive } from "@abl/engine"
import { Config, Effect, Layer } from "effect"
import { createServer } from "node:http"
import * as NodePath from "node:path"
import { fileURLToPath } from "node:url"
import { ApiLive } from "./handlers.js"
import { withStaticDashboard } from "./static.js"

/** `packages/server/dist` at runtime — the anchor for sibling-package paths. */
const moduleDir = NodePath.dirname(fileURLToPath(import.meta.url))
const webDist = NodePath.resolve(moduleDir, "../../web/dist")

/**
 * Scenario roots in precedence order: the user's local workspace
 * (`$ABL_HOME/scenarios`) shadows the repo's library on id collisions.
 * `ABL_SCENARIO_ROOTS` (colon-separated) replaces both.
 */
const scenarioRoots = (): ReadonlyArray<string> => {
  const fromEnv = process.env.ABL_SCENARIO_ROOTS
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv.split(":").filter((root) => root.length > 0)
  }
  return [NodePath.join(defaultAblHome(), "scenarios"), NodePath.resolve(moduleDir, "../../../scenarios")]
}

const ServerLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* Config.integer("ABL_PORT").pipe(Config.withDefault(4477))
    // Local-only, no auth: the lab is a solo local-first tool, so the server
    // binds 127.0.0.1 exclusively (never 0.0.0.0) and carries no
    // authentication — nothing here is ever reachable from another machine.
    return NodeHttpServer.layer(createServer, { host: "127.0.0.1", port })
  }),
)

const MainLive = HttpApiBuilder.serve(withStaticDashboard(webDist)).pipe(
  HttpServer.withLogAddress,
  Layer.provide(ApiLive),
  Layer.provide(EngineLive({ scenarioRoots: scenarioRoots(), adapters: cliAdapters })),
  Layer.provide(ServerLive),
  Layer.provide(NodeContext.layer),
)

NodeRuntime.runMain(Layer.launch(MainLive))
