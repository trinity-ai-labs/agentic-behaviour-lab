import { createQuery } from '@tanstack/solid-query';
import { api, type ResultsFilter } from '../../api/client';
import { queryKeys } from '../keys';
import { QUERY_TIERS } from '../tiers';

/**
 * The comparison-grid data source: GET /api/results, narrowed by
 * scenario/model/condition/harness. `enabled` (default always-on) parks the
 * query without fetching — callers gate it on "will this data actually
 * render?" so e.g. an unpicked scenario or a single-harness run detail never
 * pulls the whole results index for nothing.
 */
export const useResults = (filter: () => ResultsFilter, enabled: () => boolean = () => true) =>
  createQuery(() => ({
    queryKey: queryKeys.results(filter()),
    queryFn: () => api.results.list(filter()),
    enabled: enabled(),
    ...QUERY_TIERS.semiStable,
  }));
