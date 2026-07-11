/**
 * The one seam between the Solid app and the sidecar: a thin fetch wrapper
 * typed against @abl/engine's schema types and @abl/server's derived
 * read-side views. Both are `import type` only — no Effect runtime ever
 * ships in this bundle (docs/ARCHITECTURE.md: the dashboard talks to the
 * HTTP API, never the engine directly). Server state itself lives in
 * Solid Query (src/query/*); this module is just "fetch JSON, throw on
 * error" — no caching, no retries, no dedup here.
 */
import type {
  CellSummary,
  ExecutionShape,
  RunConfig,
  RunRecord,
  ScenarioDefinition,
  TrialRecord,
} from '@abl/engine';
import type { CellProgress, RunDetail, RunStarted, TrialDetail } from '@abl/server';

export type {
  CellProgress,
  CellSummary,
  ExecutionShape,
  RunConfig,
  RunDetail,
  RunRecord,
  RunStarted,
  ScenarioDefinition,
  TrialDetail,
  TrialRecord,
};

/** Mirrors the wire error tags in packages/server/src/api.ts — decoded from the JSON error body when present. */
export class ApiError extends Error {
  readonly status: number;
  readonly tag: string | undefined;

  constructor(status: number, tag: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.tag = tag;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    const tag = typeof body?._tag === 'string' ? body._tag : undefined;
    const message =
      typeof body?.message === 'string' ? body.message : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, tag, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

export interface ResultsFilter {
  readonly scenarioId?: string;
  readonly model?: string;
  readonly condition?: string;
  readonly harness?: string;
}

const toQueryString = (filter: ResultsFilter): string => {
  const params = new URLSearchParams();
  if (filter.scenarioId !== undefined) params.set('scenarioId', filter.scenarioId);
  if (filter.model !== undefined) params.set('model', filter.model);
  if (filter.condition !== undefined) params.set('condition', filter.condition);
  if (filter.harness !== undefined) params.set('harness', filter.harness);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
};

/** The lab's HTTP API, one function per AblApi endpoint (packages/server/src/api.ts). */
export const api = {
  scenarios: {
    list: (): Promise<ReadonlyArray<ScenarioDefinition>> => request('/scenarios'),
  },
  runs: {
    list: (): Promise<ReadonlyArray<RunRecord>> => request('/runs'),
    get: (runId: string): Promise<RunDetail> => request(`/runs/${encodeURIComponent(runId)}`),
    create: (config: RunConfig): Promise<RunStarted> =>
      request('/runs', { method: 'POST', body: JSON.stringify(config) }),
  },
  results: {
    list: (filter: ResultsFilter = {}): Promise<ReadonlyArray<CellSummary>> =>
      request(`/results${toQueryString(filter)}`),
    reindex: (): Promise<void> => request('/reindex', { method: 'POST' }),
  },
  trials: {
    get: (trialId: string): Promise<TrialDetail> =>
      request(`/trials/${encodeURIComponent(trialId)}`),
  },
};
