/**
 * Freshness presets, spread into query options so policy is a vocabulary
 * ("this read is `live`") rather than scattered magic numbers.
 */
export const QUERY_TIERS = {
  /** Scenario library: filesystem-backed, changes only when a user edits scenarios/. */
  stable: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  /** Run list, completed run detail, results/benchmarks: edited occasionally by new runs. */
  semiStable: { staleTime: 30_000, gcTime: 10 * 60_000 },
  /** A running run's detail — polled while trials are landing. */
  live: { staleTime: 2_000, gcTime: 5 * 60_000 },
} as const
