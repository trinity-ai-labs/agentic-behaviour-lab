import { createQuery } from '@tanstack/solid-query';
import { api } from '../../api/client';
import { queryKeys } from '../keys';
import { QUERY_TIERS } from '../tiers';

export const useScenarios = () =>
  createQuery(() => ({
    queryKey: queryKeys.scenarios(),
    queryFn: () => api.scenarios.list(),
    ...QUERY_TIERS.stable,
  }));
