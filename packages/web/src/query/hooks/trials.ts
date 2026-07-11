import { createQuery } from "@tanstack/solid-query"
import { api } from "../../api/client"
import { queryKeys } from "../keys"
import { QUERY_TIERS } from "../tiers"

export const useTrial = (trialId: () => string) =>
  createQuery(() => ({
    queryKey: queryKeys.trial(trialId()),
    queryFn: () => api.trials.get(trialId()),
    enabled: trialId().length > 0,
    ...QUERY_TIERS.stable,
  }))
