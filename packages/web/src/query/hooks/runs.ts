import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query"
import { api, type RunConfig } from "../../api/client"
import { queryKeys } from "../keys"
import { QUERY_TIERS } from "../tiers"

export const useRuns = () =>
  createQuery(() => ({
    queryKey: queryKeys.runs(),
    queryFn: () => api.runs.list(),
    ...QUERY_TIERS.semiStable,
  }))

/**
 * Polls a run's detail while it's still going: `refetchInterval` reads the
 * data already in cache to decide whether to keep polling, so it stops
 * itself the instant the run leaves "running" — no manual interval/cleanup.
 */
export const useRun = (runId: () => string) =>
  createQuery(() => ({
    queryKey: queryKeys.run(runId()),
    queryFn: () => api.runs.get(runId()),
    enabled: runId().length > 0,
    ...QUERY_TIERS.live,
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 1_000 : false),
  }))

/** POST /api/runs — launches a batch; the launcher navigates to the new run's detail page on success. */
export const useCreateRun = () => {
  const queryClient = useQueryClient()
  return createMutation(() => ({
    mutationFn: (config: RunConfig) => api.runs.create(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() })
    },
  }))
}
