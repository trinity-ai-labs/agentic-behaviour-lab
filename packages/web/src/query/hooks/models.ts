import { createQuery } from '@tanstack/solid-query';
import { api } from '../../api/client';
import { queryKeys } from '../keys';
import { QUERY_TIERS } from '../tiers';

/** The model catalog — static at runtime, fetched once. */
export const useModels = () =>
  createQuery(() => ({
    queryKey: queryKeys.models(),
    queryFn: () => api.models.list(),
    ...QUERY_TIERS.semiStable,
  }));
