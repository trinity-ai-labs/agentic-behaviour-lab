/**
 * One composed layer for the whole engine, so consumers (tests, the smoke
 * script, packages/mcp, packages/server) don't each re-derive the service
 * wiring order. Callers pick the registered adapters (real CLIs vs stubs)
 * and the scenario roots; everything else is wired here. The platform
 * services (FileSystem, Path, CommandExecutor) stay in the requirements so
 * the caller supplies `NodeContext.layer` — the engine itself is
 * runtime-agnostic.
 */
import { CommandExecutor, FileSystem, Path } from '@effect/platform';
import { Layer } from 'effect';
import { AdapterRegistryLive, type AdapterMap } from './adapter.js';
import { IndexError, TrialIndex, TrialIndexLive } from './index-db.js';
import { Runner, RunnerLive } from './runner.js';
import { ScenarioRepo, ScenarioRepoLive } from './scenarios.js';
import { ArtifactStore, ArtifactStoreLive } from './store.js';

export interface EngineConfig {
  /** Root of the store + index; defaults to `$ABL_HOME` / `~/.abl`. */
  readonly ablHome?: string;
  /** Scenario directories, searched in precedence order. */
  readonly scenarioRoots: ReadonlyArray<string>;
  /**
   * Harness id -> adapter layer: `cliAdapters` (both real CLIs) in
   * production entrypoints, `{ "claude-cli": StubAdapterLive(...) }` in
   * tests. `RunConfig.harnesses` selects among these per run; every harness
   * a run might request must be registered here.
   */
  readonly adapters: AdapterMap;
}

export const EngineLive = (
  config: EngineConfig,
): Layer.Layer<
  Runner | ArtifactStore | ScenarioRepo | TrialIndex,
  IndexError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> => {
  const store = ArtifactStoreLive(config.ablHome);
  const scenarios = ScenarioRepoLive(config.scenarioRoots);
  const index = TrialIndexLive.pipe(Layer.provide(store));
  const registry = AdapterRegistryLive(config.adapters);
  const runner = RunnerLive.pipe(Layer.provide(Layer.mergeAll(scenarios, store, registry, index)));
  // The same layer references appear in several places; layer memoization
  // builds each service once and shares it across every consumer.
  return Layer.mergeAll(runner, store, scenarios, index);
};
