import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ScenarioDefinition } from '../api/client';
import { Modal } from '../components/Modal';
import { RunLauncher } from '../components/RunLauncher';
import { ScenarioCard } from '../components/ScenarioCard';
import { useScenarios } from '../query/hooks/scenarios';
import shared from '../styles/shared.module.css';
import styles from './Scenarios.module.css';

export const Scenarios = () => {
  const scenariosQuery = useScenarios();
  const [search, setSearch] = createSignal('');
  const [runScenario, setRunScenario] = createSignal<ScenarioDefinition | undefined>();

  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    const data = scenariosQuery.data;
    if (!data) return [];
    if (q.length === 0) return data;
    return data.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.family.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  });

  return (
    <div class={styles.page}>
      <div class={styles.topBar}>
        <h1 class={styles.title}>Scenarios</h1>
        <input
          class={styles.search}
          type="text"
          placeholder="Filter scenarios…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <Show when={scenariosQuery.isPending}>
        <p class={shared.status}>Loading scenarios…</p>
      </Show>
      <Show when={scenariosQuery.isError}>
        <p class={shared.statusError}>
          Failed to load scenarios: {String(scenariosQuery.error?.message)}
        </p>
      </Show>

      <Show when={scenariosQuery.data}>
        <Show
          when={filtered().length > 0}
          fallback={<p class={shared.status}>No scenarios match "{search()}"</p>}
        >
          <div class={styles.cards}>
            <For each={filtered()}>
              {(scenario) => (
                <ScenarioCard scenario={scenario} onRun={() => setRunScenario(scenario)} />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Modal
        open={runScenario() !== undefined}
        onClose={() => setRunScenario()}
        title="Run trials"
      >
        <Show when={runScenario() !== undefined && scenariosQuery.data}>
          <RunLauncher
            scenarios={scenariosQuery.data!}
            preselectedScenario={runScenario()}
          />
        </Show>
      </Modal>
    </div>
  );
};
