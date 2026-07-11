/**
 * Typed client for the authoring endpoints, derived from the very `AblApi`
 * contract the server implements (`HttpApiClient.make`) — request encoding,
 * response decoding, and tagged-error revival all come from the shared
 * schemas, so this client cannot drift from the server without a compile
 * error. Requests go to the page's own origin: the dashboard is served by
 * the same 127.0.0.1 server that answers `/api` (solo local-first tool, no
 * remote origin ever). No streaming, no retries: v1 is one request per
 * action.
 */
import { FetchHttpClient, HttpApiClient } from "@effect/platform"
import type { ScenarioDefinition } from "@abl/engine"
import { Effect, Either } from "effect"
import {
  AblApi,
  AuthorFailed,
  ScenarioSaveInvalid,
  ScenarioSavePathRejected,
  type AuthoredFile,
  type AuthorRequest,
  type AuthorResponse,
  type SaveScenarioRequest,
} from "@abl/server"

const makeClient = HttpApiClient.make(AblApi).pipe(Effect.provide(FetchHttpClient.layer))

/** The server's tagged wire errors arrive revived as their classes; everything else (network, decode) falls back to its printed form. */
const describeError = (error: unknown): string => {
  if (error instanceof AuthorFailed) {
    return `The draft came back malformed. Raw output tail:\n${error.rawTail}`
  }
  if (error instanceof ScenarioSavePathRejected) {
    return `Rejected "${error.path}": ${error.reason}`
  }
  if (error instanceof ScenarioSaveInvalid) {
    return `Saved files don't form a valid scenario: ${error.reason}`
  }
  return String(error)
}

/** Adapts an API-call effect to the view's plain-promise world: resolve with the value, reject with a human-readable `Error`. */
const runFriendly = async <A, E>(call: Effect.Effect<A, E>): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(call))
  if (Either.isLeft(result)) {
    throw new Error(describeError(result.left))
  }
  return result.right
}

export const draftScenario = (payload: AuthorRequest): Promise<AuthorResponse> =>
  runFriendly(Effect.flatMap(makeClient, (client) => client.authoring.draft({ payload })))

export const saveScenario = (payload: SaveScenarioRequest): Promise<ScenarioDefinition> =>
  runFriendly(Effect.flatMap(makeClient, (client) => client.authoring.save({ payload })))

export type { AuthoredFile, AuthorResponse, ScenarioDefinition }
