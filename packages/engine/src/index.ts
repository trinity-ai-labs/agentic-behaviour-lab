/**
 * `@abl/engine` public surface — the Effect core every other package in the
 * lab (MCP server, HTTP API, dashboard) builds on. Re-exports the data
 * contract (`schema.ts`) plus each service's tag, shape type, layer
 * constructor, and error types.
 */
export * from './schema.js';

export { ArtifactStore, ArtifactStoreLive, defaultAblHome, StoreError } from './store.js';
export type { ArtifactStoreShape } from './store.js';

export {
  renderBrief,
  ScenarioInvalid,
  ScenarioNotFound,
  ScenarioRepo,
  ScenarioRepoLive,
} from './scenarios.js';
export type { LoadedScenario, ScenarioLoadError, ScenarioRepoShape } from './scenarios.js';

export {
  AdapterRegistry,
  AdapterRegistryLive,
  AgentAdapter,
  AgentRunError,
  CLAUDE_CLI_HARNESS,
  ClaudeCliAdapterLive,
  cliAdapters,
  CODEX_CLI_HARNESS,
  CodexCliAdapterLive,
  StubAdapterLive,
  UnknownHarnessError,
} from './adapter.js';
export type {
  AdapterMap,
  AdapterRegistryShape,
  AgentAdapterShape,
  SubjectResult,
} from './adapter.js';

export { IndexError, TrialIndex, TrialIndexLive } from './index-db.js';
export type { CellFilter, TrialIndexShape } from './index-db.js';

export { RunConfigError, Runner, RunnerLive } from './runner.js';
export type { RunBatchError, RunnerShape, RunTrialError, RunTrialParams } from './runner.js';

export { EngineLive } from './engine.js';
export type { EngineConfig } from './engine.js';
