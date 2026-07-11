import { A } from "@solidjs/router"
import { For, Show } from "solid-js"
import { StatusBadge } from "../components/StatusBadge"
import { formatDuration, formatTimestamp } from "../lib/format"
import { useRuns } from "../query/hooks/runs"
import shared from "../styles/shared.module.css"
import styles from "./Runs.module.css"

export const Runs = () => {
  const runsQuery = useRuns()

  return (
    <div class={styles.page}>
      <h1 class={styles.title}>Runs</h1>

      <Show when={runsQuery.isPending}>
        <p class={shared.status}>Loading runs…</p>
      </Show>
      <Show when={runsQuery.isError}>
        <p class={shared.statusError}>Failed to load runs: {String(runsQuery.error?.message)}</p>
      </Show>
      <Show when={runsQuery.data}>
        {(runs) => (
          <Show when={runs().length > 0} fallback={<p class={shared.status}>No runs yet — launch one from Scenarios.</p>}>
            <ul class={styles.list}>
              <For each={[...runs()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))}>
                {(run) => (
                  <li class={styles.row}>
                    <A href={`/runs/${run.runId}`} class={styles.link}>
                      <span class={styles.runId}>{run.runId}</span>
                      <span class={styles.scenario}>{run.config.scenarioId}</span>
                      <span class={styles.meta}>
                        {run.config.models.join(", ")} · {run.config.harnesses?.join(", ") ?? "claude-cli"}
                      </span>
                      <span class={styles.meta}>{formatTimestamp(run.startedAt)}</span>
                      <span class={styles.meta}>{formatDuration(run.startedAt, run.endedAt)}</span>
                      <StatusBadge status={run.status} />
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  )
}
