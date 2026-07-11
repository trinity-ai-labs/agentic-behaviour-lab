/**
 * The typed key factory — every query key comes from here, never a
 * hand-typed array, so a reader and its invalidator can't drift apart. No
 * account/scope prefixing (solo local-first tool, no auth) — keys are just
 * the query family plus its narrowing args.
 */
import type { ResultsFilter } from '../api/client';

export const queryKeys = {
  scenarios: () => ['scenarios'] as const,
  runs: () => ['runs'] as const,
  run: (runId: string) => ['runs', runId] as const,
  results: (filter: ResultsFilter = {}) => ['results', filter] as const,
  trial: (trialId: string) => ['trials', trialId] as const,
};
