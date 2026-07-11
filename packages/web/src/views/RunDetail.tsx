/**
 * A single run, live: per-cell pips filling in as trials land (polled via
 * useRun, which stops polling itself once the run leaves "running").
 *
 * KNOWN GAP (documented per the brief): `RunDetail.CellProgress` — the
 * `/api/runs/:runId` payload — aggregates a cell's counts across every
 * harness in the run; it carries no harness field. Rather than leave
 * harness invisible here, each cell ALSO cross-references
 * `/api/results?scenarioId=...` (already harness-split, and itself live —
 * the index updates per trial same as CellProgress) and renders a small
 * per-harness breakdown line whenever the run's config requests more than
 * one harness. The combined pip grid (from CellProgress, which alone knows
 * `expectedTrials` for the pending-pip count) stays the primary view; the
 * breakdown is corroborating detail, not a second grid.
 */
import { A, useParams } from "@solidjs/router"
import { For, Show, createMemo } from "solid-js"
import type { CellSummary, RunDetail as RunDetailPayload } from "../api/client"
import { PipGrid } from "../components/PipGrid"
import { StatusBadge } from "../components/StatusBadge"
import { failRateOf, formatDuration, formatFailRate, formatTimestamp, shortenHarness } from "../lib/format"
import { landedCount } from "../lib/verdict"
import { useResults } from "../query/hooks/results"
import { useRun } from "../query/hooks/runs"
import shared from "../styles/shared.module.css"
import styles from "./RunDetail.module.css"

export const RunDetail = () => {
  const params = useParams<{ runId: string }>()
  const runQuery = useRun(() => params.runId)

  return (
    <div class={styles.page}>
      <Show when={runQuery.isPending}>
        <p class={shared.status}>Loading run…</p>
      </Show>
      <Show when={runQuery.isError}>
        <p class={shared.statusError}>Failed to load run: {String(runQuery.error?.message)}</p>
      </Show>
      <Show when={runQuery.data}>{(detail) => <RunBody detail={detail()} />}</Show>
    </div>
  )
}

const RunBody = (props: { detail: RunDetailPayload }) => {
  const multiHarness = createMemo(() => (props.detail.run.config.harnesses?.length ?? 1) > 1)
  // Only fetched when the breakdown will actually render (multi-harness run).
  const resultsQuery = useResults(() => ({ scenarioId: props.detail.run.config.scenarioId }), multiHarness)

  // Grouped once per data change instead of a full filter() scan per cell.
  const breakdownByCell = createMemo(() => {
    const map = new Map<string, Array<CellSummary>>()
    for (const summary of resultsQuery.data ?? []) {
      const key = `${summary.condition}␟${summary.modelId}`
      const bucket = map.get(key)
      if (bucket === undefined) map.set(key, [summary])
      else bucket.push(summary)
    }
    return map
  })

  const harnessBreakdown = (condition: string, modelId: string) =>
    breakdownByCell().get(`${condition}␟${modelId}`) ?? []

  return (
    <>
      <div class={styles.header}>
        <div>
          <h1 class={styles.title}>
            Run <span class={styles.runId}>{props.detail.run.runId}</span>
          </h1>
          <p class={styles.subtitle}>{props.detail.run.config.scenarioId}</p>
        </div>
        <StatusBadge status={props.detail.run.status} />
      </div>
      <p class={styles.meta}>
        started {formatTimestamp(props.detail.run.startedAt)} · {formatDuration(props.detail.run.startedAt, props.detail.run.endedAt)}
      </p>

      <div class={styles.cells}>
        <For each={props.detail.cells}>
          {(cell) => (
            <div class={styles.cell}>
              <div class={styles.cellHeader}>
                <span class={styles.cellCondition}>{cell.condition}</span>
                <span class={styles.cellModel}>{cell.modelId}</span>
              </div>
              <PipGrid
                pass={cell.pass}
                fail={cell.fail}
                inconclusive={cell.inconclusive}
                error={cell.error}
                expected={cell.expectedTrials}
              />
              <div class={styles.cellStat}>
                {formatFailRate(failRateOf(cell.pass, cell.fail), cell.pass, cell.fail)} · {landedCount(cell)}/
                {cell.expectedTrials} landed
              </div>
              <Show when={multiHarness()}>
                <ul class={styles.harnessBreakdown}>
                  <For each={harnessBreakdown(cell.condition, cell.modelId)}>
                    {(h) => (
                      <li>
                        <span class={styles.harnessName}>{shortenHarness(h.harness)}</span>{" "}
                        {formatFailRate(h.failRate, h.pass, h.fail)} ({h.trials} trials)
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={cell.trialIds.length > 0}>
                <details class={styles.trialLinks}>
                  <summary>trials ({cell.trialIds.length})</summary>
                  <ul class={styles.trialLinkList}>
                    <For each={cell.trialIds}>
                      {(trialId) => (
                        <li>
                          <A href={`/trials/${trialId}`} class={styles.trialLink}>
                            {trialId}
                          </A>
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
