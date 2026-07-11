/**
 * The HTTP wire contract. Every payload and response is either an engine
 * schema (`@abl/engine` re-exports `schema.ts`, the lab's data contract) or a
 * derived read-side view defined here — the wire format can never drift from
 * the trial records on disk because it IS those schemas.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { CellSummary, RunConfig, RunRecord, ScenarioDefinition, TrialRecord } from "@abl/engine"
import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Wire errors — Schema classes (not the engine's Data.TaggedError values) so
// each one carries its HTTP status and serializes as a tagged JSON body the
// derived client decodes back into the same class.
// ---------------------------------------------------------------------------

export class ScenarioNotFound extends Schema.TaggedError<ScenarioNotFound>()(
  "ScenarioNotFound",
  { scenarioId: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}

export class RunRejected extends Schema.TaggedError<RunRejected>()(
  "RunRejected",
  { reason: Schema.String },
  HttpApiSchema.annotations({ status: 400 }),
) {}

export class RunNotFound extends Schema.TaggedError<RunNotFound>()(
  "RunNotFound",
  { runId: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}

export class TrialNotFound extends Schema.TaggedError<TrialNotFound>()(
  "TrialNotFound",
  { trialId: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}

/** The authoring CLI call returned something that didn't decode as `AuthorResponse` — the tail lets a human see what actually came back. */
export class AuthorFailed extends Schema.TaggedError<AuthorFailed>()(
  "AuthorFailed",
  { rawTail: Schema.String },
  HttpApiSchema.annotations({ status: 502 }),
) {}

export class ScenarioSavePathRejected extends Schema.TaggedError<ScenarioSavePathRejected>()(
  "ScenarioSavePathRejected",
  { scenarioId: Schema.String, path: Schema.String, reason: Schema.String },
  HttpApiSchema.annotations({ status: 400 }),
) {}

/** A saved draft didn't decode as a `ScenarioDefinition` (or a file it references is missing) — the caller edits the draft and re-saves. */
export class ScenarioSaveInvalid extends Schema.TaggedError<ScenarioSaveInvalid>()(
  "ScenarioSaveInvalid",
  { scenarioId: Schema.String, reason: Schema.String },
  HttpApiSchema.annotations({ status: 422 }),
) {}

// ---------------------------------------------------------------------------
// Derived read-side views — computed from the flat-file store per request,
// never stored anywhere.
// ---------------------------------------------------------------------------

/** POST /api/runs responds as soon as the batch is forked, not when it ends. */
export const RunStarted = Schema.Struct({ runId: Schema.String })
export type RunStarted = typeof RunStarted.Type

/**
 * Progress of one (condition × model) cell of a run: how many trials the
 * config promises versus the trial records already on disk, split by verdict.
 */
export const CellProgress = Schema.Struct({
  condition: Schema.String,
  modelId: Schema.String,
  /** Trials the run config promises for this cell (`trialsPerCell`). */
  expectedTrials: Schema.Number,
  /** Ids of the trial records written so far — feed them to GET /api/trials/:trialId. */
  trialIds: Schema.Array(Schema.String),
  pass: Schema.Number,
  fail: Schema.Number,
  inconclusive: Schema.Number,
  error: Schema.Number,
})
export type CellProgress = typeof CellProgress.Type

export const RunDetail = Schema.Struct({
  run: RunRecord,
  cells: Schema.Array(CellProgress),
})
export type RunDetail = typeof RunDetail.Type

/** Artifact files at or under this size are inlined into GET /api/trials/:trialId. */
export const INLINE_ARTIFACT_LIMIT = 256 * 1024

/**
 * A trial record plus the contents of its small artifacts. `trial.artifacts`
 * still names every artifact (as relative paths); `inlined` holds the content
 * of those within `INLINE_ARTIFACT_LIMIT` — larger ones stay path-only.
 */
export const TrialDetail = Schema.Struct({
  trial: TrialRecord,
  inlined: Schema.Record({ key: Schema.String, value: Schema.String }),
})
export type TrialDetail = typeof TrialDetail.Type

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const runIdParam = HttpApiSchema.param("runId", Schema.String)
const trialIdParam = HttpApiSchema.param("trialId", Schema.String)

const ScenariosGroup = HttpApiGroup.make("scenarios").add(
  HttpApiEndpoint.get("list", "/scenarios").addSuccess(Schema.Array(ScenarioDefinition)),
)

const RunsGroup = HttpApiGroup.make("runs")
  .add(
    HttpApiEndpoint.post("create", "/runs")
      .setPayload(RunConfig)
      .addSuccess(RunStarted, { status: 202 })
      .addError(ScenarioNotFound)
      .addError(RunRejected),
  )
  .add(HttpApiEndpoint.get("list", "/runs").addSuccess(Schema.Array(RunRecord)))
  .add(HttpApiEndpoint.get("get")`/runs/${runIdParam}`.addSuccess(RunDetail).addError(RunNotFound))

const ResultsGroup = HttpApiGroup.make("results")
  .add(
    HttpApiEndpoint.get("list", "/results")
      .setUrlParams(
        Schema.Struct({
          scenarioId: Schema.optional(Schema.String),
          model: Schema.optional(Schema.String),
          condition: Schema.optional(Schema.String),
          /** Exact fingerprint harness string as reported in cell rows. */
          harness: Schema.optional(Schema.String),
        }),
      )
      .addSuccess(Schema.Array(CellSummary)),
  )
  // No success schema: a completed rebuild answers 204 — the index is derived
  // state, so there is nothing meaningful to return beyond "done".
  .add(HttpApiEndpoint.post("reindex", "/reindex"))

const TrialsGroup = HttpApiGroup.make("trials").add(
  HttpApiEndpoint.get("get")`/trials/${trialIdParam}`.addSuccess(TrialDetail).addError(TrialNotFound),
)

// ---------------------------------------------------------------------------
// Authoring — describe a behaviour in prose, get a drafted scenario back for
// review, then save the reviewed draft into the local workspace.
// ---------------------------------------------------------------------------

/** One file of a drafted (or reviewed) scenario, keyed by path relative to the scenario directory. */
export const AuthoredFile = Schema.Struct({ path: Schema.String, content: Schema.String })
export type AuthoredFile = typeof AuthoredFile.Type

export const AuthorRequest = Schema.Struct({
  description: Schema.String,
  notes: Schema.optional(Schema.String),
})
export type AuthorRequest = typeof AuthorRequest.Type

/** Also the shape the authoring CLI's own output must decode as — see `authoring.ts`. */
export const AuthorResponse = Schema.Struct({
  files: Schema.Array(AuthoredFile),
  rationale: Schema.String,
})
export type AuthorResponse = typeof AuthorResponse.Type

export const SaveScenarioRequest = Schema.Struct({
  scenarioId: Schema.String,
  files: Schema.Array(AuthoredFile),
})
export type SaveScenarioRequest = typeof SaveScenarioRequest.Type

const AuthoringGroup = HttpApiGroup.make("authoring")
  .add(
    HttpApiEndpoint.post("draft", "/author")
      .setPayload(AuthorRequest)
      .addSuccess(AuthorResponse)
      .addError(AuthorFailed),
  )
  .add(
    HttpApiEndpoint.post("save", "/scenarios/save")
      .setPayload(SaveScenarioRequest)
      .addSuccess(ScenarioDefinition)
      .addError(ScenarioSavePathRejected)
      .addError(ScenarioSaveInvalid),
  )

export const AblApi = HttpApi.make("abl")
  .add(ScenariosGroup)
  .add(RunsGroup)
  .add(ResultsGroup)
  .add(TrialsGroup)
  .add(AuthoringGroup)
  .prefix("/api")
