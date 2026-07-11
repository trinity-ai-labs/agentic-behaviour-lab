/**
 * Home: scenario picker -> the model-comparison grid, headlined by the pip
 * grid signature. Every rate shown carries its N; inconclusive and error
 * stay visible in every cell rather than being folded away.
 */
import { createMemo, createSignal, For, Show } from "solid-js"
import { ComparisonGrid } from "../components/ComparisonGrid"
import { VerdictLegend } from "../components/VerdictLegend"
import { useResults } from "../query/hooks/results"
import { useScenarios } from "../query/hooks/scenarios"
import shared from "../styles/shared.module.css"
import styles from "./Benchmarks.module.css"

export const Benchmarks = () => {
  const scenariosQuery = useScenarios()
  const [scenarioId, setScenarioId] = createSignal<string>("")

  const scenario = createMemo(() => scenariosQuery.data?.find((s) => s.scenarioId === scenarioId()))
  const resultsQuery = useResults(
    () => ({ scenarioId: scenarioId() }),
    () => scenarioId().length > 0,
  )

  return (
    <div class={styles.page}>
      <div class={styles.headerRow}>
        <div>
          <h1 class={styles.title}>Benchmarks</h1>
          <p class={styles.subtitle}>Same scenario, same prompt — rates compared side by side per model × harness.</p>
        </div>
        <VerdictLegend />
      </div>

      <Show when={scenariosQuery.isPending}>
        <p class={shared.status}>Loading scenarios…</p>
      </Show>
      <Show when={scenariosQuery.isError}>
        <p class={shared.statusError}>Failed to load scenarios: {String(scenariosQuery.error?.message)}</p>
      </Show>

      <Show when={scenariosQuery.data}>
        {(scenarios) => (
          <>
            <label class={styles.picker}>
              <span class={styles.pickerLabel}>Scenario</span>
              <select
                class={styles.select}
                value={scenarioId()}
                onChange={(e) => setScenarioId(e.currentTarget.value)}
              >
                <option value="" disabled>
                  Choose a scenario…
                </option>
                <For each={scenarios()}>{(s) => <option value={s.scenarioId}>{s.title}</option>}</For>
              </select>
            </label>

            <Show when={scenario()}>
              {(s) => (
                <>
                  <Show when={resultsQuery.isPending}>
                    <p class={shared.status}>Loading results…</p>
                  </Show>
                  <Show when={resultsQuery.data}>
                    {(cells) => (
                      <Show
                        when={cells().length > 0}
                        fallback={<p class={shared.status}>No trials run for this scenario yet — start one from Scenarios.</p>}
                      >
                        <ComparisonGrid scenario={s()} cells={cells()} />
                      </Show>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
