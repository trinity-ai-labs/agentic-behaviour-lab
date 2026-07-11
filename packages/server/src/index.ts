/**
 * `@abl/server` public surface. The wire contract (`AblApi` + its schemas and
 * error classes) is what a dashboard or test derives a typed client from via
 * `HttpApiClient.make`; `ApiLive` is the implemented API for embedding the
 * server in another layer graph (the tests serve it on an ephemeral port).
 */
export * from './api.js';
export { ApiLive } from './handlers.js';
export { withStaticDashboard } from './static.js';
