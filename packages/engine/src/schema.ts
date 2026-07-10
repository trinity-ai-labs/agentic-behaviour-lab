/**
 * The lab's data contract. Every package — runner, MCP server, dashboard —
 * meets at these schemas, and every trial's `trial.json` on disk decodes with
 * them. Flat files are the source of truth; anything else (SQLite, UI state)
 * is a derived index rebuilt from records that satisfy this module.
 */
import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Environment fingerprint
//
// Behaviour is version-sensitive: a record without its full environment can
// never be compared retroactively, so the fingerprint is mandatory on every
// trial from day one.
// ---------------------------------------------------------------------------

export const EnvironmentFingerprint = Schema.Struct({
  /** Exact model identifier the subject ran on, e.g. "claude-sonnet-5". */
  modelId: Schema.String,
  /** Harness that executed the trial, e.g. "claude-code/2.3.1 (headless -p)". */
  harness: Schema.String,
  /** Operating system, e.g. "darwin 25.1.0 arm64". */
  os: Schema.String,
  /** Version of the scenario definition used (its content hash or semver). */
  scenarioVersion: Schema.String,
  /** Version of the grader used (its content hash or semver). */
  graderVersion: Schema.String,
})
export type EnvironmentFingerprint = typeof EnvironmentFingerprint.Type

// ---------------------------------------------------------------------------
// Execution shapes — how a subject runs. Behaviour differs by shape, so the
// same scenario must be runnable across all of them.
// ---------------------------------------------------------------------------

export const ExecutionShape = Schema.Literal(
  "one-shot",
  "session",
  "pipeline",
  "orchestration-tree",
)
export type ExecutionShape = typeof ExecutionShape.Type

// ---------------------------------------------------------------------------
// Verdicts
//
// Statistical honesty: a verdict carries how it was reached and how strong the
// evidence is — "inconclusive" is a first-class outcome, not an error state.
// ---------------------------------------------------------------------------

export const VerdictOutcome = Schema.Literal(
  /** The behaviour under test did NOT occur (agent did the right thing). */
  "pass",
  /** The behaviour under test occurred (the failure mode manifested). */
  "fail",
  /** The grader could not determine an outcome from the artifacts. */
  "inconclusive",
  /** The trial itself broke (fixture error, spawn failure, infra stall). */
  "error",
)
export type VerdictOutcome = typeof VerdictOutcome.Type

export const Verdict = Schema.Struct({
  outcome: VerdictOutcome,
  /** Which grader tier produced this: mechanical checks first, always. */
  gradedBy: Schema.Literal("mechanical", "transcript-check", "llm-judge"),
  /** Machine-readable grader detail (chain step reached, markers found, …). */
  detail: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  /** Free-text note for humans reading the run. */
  note: Schema.optional(Schema.String),
})
export type Verdict = typeof Verdict.Type

// ---------------------------------------------------------------------------
// Trial record — one `trial.json`, the atomic unit of evidence.
// ---------------------------------------------------------------------------

export const TrialRecord = Schema.Struct({
  /** Unique id, also the artifact directory name: `<runId>/<trialId>`. */
  trialId: Schema.String,
  /** The run (batch) this trial belongs to. */
  runId: Schema.String,
  scenarioId: Schema.String,
  /**
   * The condition cell this trial belongs to: a short label plus the concrete
   * parameter values substituted into the scenario (guardrail phrasing
   * variant, tool-output variant, …). Comparisons group by (scenarioId,
   * condition.label, fingerprint.modelId).
   */
  condition: Schema.Struct({
    label: Schema.String,
    params: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  shape: ExecutionShape,
  fingerprint: EnvironmentFingerprint,
  /** ISO-8601 UTC. */
  startedAt: Schema.String,
  endedAt: Schema.String,
  /**
   * Paths relative to this trial's artifact directory. Truth lives in these
   * files; the record only points at them. `finalMessage` and `stateLog` are
   * conventional; scenarios may add their own.
   */
  artifacts: Schema.Record({ key: Schema.String, value: Schema.String }),
  verdict: Verdict,
})
export type TrialRecord = typeof TrialRecord.Type

// ---------------------------------------------------------------------------
// Scenario definition — fixtures + pressure + grader, loaded from a scenario
// directory (`scenario.json` + brief template + executable scripts).
// ---------------------------------------------------------------------------

export const ScenarioDefinition = Schema.Struct({
  scenarioId: Schema.String,
  version: Schema.String,
  title: Schema.String,
  /** Which generic behaviour family this instantiates (docs/scenario-families.md). */
  family: Schema.String,
  description: Schema.String,
  /**
   * Executable relative paths inside the scenario directory.
   * fixture: stands up the hermetic workspace (receives WORKSPACE_DIR env).
   * grader: inspects the workspace after the trial and prints a Verdict JSON
   * to stdout (receives WORKSPACE_DIR and TRIAL_DIR env).
   */
  fixture: Schema.String,
  grader: Schema.String,
  /**
   * Brief template (relative path, markdown). `{{param}}` placeholders are
   * substituted from the condition's params before dispatch.
   */
  brief: Schema.String,
  /** Named condition cells this scenario ships with. */
  conditions: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      params: Schema.Record({ key: Schema.String, value: Schema.String }),
    }),
  ),
  /** Shapes this scenario is meaningful under (the sampled matrix). */
  declaredShapes: Schema.Array(ExecutionShape),
})
export type ScenarioDefinition = typeof ScenarioDefinition.Type

// ---------------------------------------------------------------------------
// Run configuration — one benchmark invocation: a scenario fanned across
// conditions × models, N trials per cell, budget-capped.
// ---------------------------------------------------------------------------

export const RunConfig = Schema.Struct({
  scenarioId: Schema.String,
  /** Condition labels to run (must exist on the scenario). */
  conditions: Schema.Array(Schema.String),
  /** Models to compare — the "same prompt, compare by model" axis. */
  models: Schema.Array(Schema.String),
  shape: ExecutionShape,
  /** Trials per (condition × model) cell. */
  trialsPerCell: Schema.Number,
  /** Hard cap on concurrently running trials. */
  maxConcurrent: Schema.optionalWith(Schema.Number, { default: () => 4 }),
})
export type RunConfig = typeof RunConfig.Type

export const RunRecord = Schema.Struct({
  runId: Schema.String,
  config: RunConfig,
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  status: Schema.Literal("running", "completed", "aborted"),
})
export type RunRecord = typeof RunRecord.Type

// ---------------------------------------------------------------------------
// Aggregates — what the dashboard and MCP results tools serve. Always derived
// from trial records, never stored as truth.
// ---------------------------------------------------------------------------

export const CellSummary = Schema.Struct({
  scenarioId: Schema.String,
  condition: Schema.String,
  modelId: Schema.String,
  shape: ExecutionShape,
  trials: Schema.Number,
  pass: Schema.Number,
  fail: Schema.Number,
  inconclusive: Schema.Number,
  error: Schema.Number,
  /** fail / (pass + fail) — rate of the behaviour manifesting; null until graded trials exist. */
  failRate: Schema.NullOr(Schema.Number),
})
export type CellSummary = typeof CellSummary.Type
