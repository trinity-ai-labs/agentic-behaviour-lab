import { For, Show } from "solid-js"
import { RunLauncher } from "../components/RunLauncher"
import { ScenarioCard } from "../components/ScenarioCard"
import { useScenarios } from "../query/hooks/scenarios"
import shared from "../styles/shared.module.css"
import styles from "./Scenarios.module.css"

export const Scenarios = () => {
  const scenariosQuery = useScenarios()

  return (
    <div class={styles.page}>
      <h1 class={styles.title}>Scenarios</h1>

      <Show when={scenariosQuery.isPending}>
        <p class={shared.status}>Loading scenarios…</p>
      </Show>
      <Show when={scenariosQuery.isError}>
        <p class={shared.statusError}>Failed to load scenarios: {String(scenariosQuery.error?.message)}</p>
      </Show>

      <Show when={scenariosQuery.data}>
        {(scenarios) => (
          <div class={styles.layout}>
            <div class={styles.cards}>
              <For each={scenarios()}>{(scenario) => <ScenarioCard scenario={scenario} />}</For>
            </div>
            <RunLauncher scenarios={scenarios()} />
          </div>
        )}
      </Show>
    </div>
  )
}
