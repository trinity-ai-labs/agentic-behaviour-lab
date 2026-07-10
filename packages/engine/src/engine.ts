/**
 * One composed layer for the whole engine, so consumers (tests, the smoke
 * script, packages/mcp, packages/server) don't each re-derive the service
 * wiring order. Callers pick the adapter (real CLI vs stub) and the
 * scenario roots; everything else is wired here. The platform services
 * (FileSystem, Path, CommandExecutor) stay in the requirements so the
 * caller supplies `NodeContext.layer` — the engine itself is
 * runtime-agnostic.
 */
import { CommandExecutor, FileSystem, Path } from "@effect/platform"
import { Layer } from "effect"
import { AgentAdapter } from "./adapter.js"
import { IndexError, TrialIndex, TrialIndexLive } from "./index-db.js"
import { Runner, RunnerLive } from "./runner.js"
import { ScenarioRepo, ScenarioRepoLive } from "./scenarios.js"
import { ArtifactStore, ArtifactStoreLive } from "./store.js"

export interface EngineConfig {
  /** Root of the store + index; defaults to `$ABL_HOME` / `~/.abl`. */
  readonly ablHome?: string
  /** Scenario directories, searched in precedence order. */
  readonly scenarioRoots: ReadonlyArray<string>
  /** Which agent plays the subject: `ClaudeCliAdapterLive` or `StubAdapterLive(...)`. */
  readonly adapter: Layer.Layer<AgentAdapter, never, CommandExecutor.CommandExecutor>
}

export const EngineLive = (
  config: EngineConfig,
): Layer.Layer<
  Runner | ArtifactStore | ScenarioRepo | TrialIndex,
  IndexError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> => {
  const store = ArtifactStoreLive(config.ablHome)
  const scenarios = ScenarioRepoLive(config.scenarioRoots)
  const index = TrialIndexLive.pipe(Layer.provide(store))
  const runner = RunnerLive.pipe(Layer.provide(Layer.mergeAll(scenarios, store, config.adapter, index)))
  // The same layer references appear in several places; layer memoization
  // builds each service once and shares it across every consumer.
  return Layer.mergeAll(runner, store, scenarios, index)
}
