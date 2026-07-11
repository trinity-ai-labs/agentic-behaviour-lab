/**
 * The new-run launcher: scenario -> conditions/models/harnesses/shape/N
 * pickers -> POST /api/runs. Harness selection is first-class (RunConfig's
 * `harnesses` array defaults to ["claude-cli"] but a comparison run wants
 * both CLIs side by side) — well-known ids get checkboxes; a free-text
 * field covers a locally registered stub/harness id for dev/testing.
 */
import { useNavigate } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ExecutionShape, RunConfig, ScenarioDefinition } from '../api/client';
import { useCreateRun } from '../query/hooks/runs';
import { Select } from './Select';
import styles from './RunLauncher.module.css';

const WELL_KNOWN_HARNESSES = ['claude-cli', 'codex-cli'] as const;

export const RunLauncher = (props: { scenarios: ReadonlyArray<ScenarioDefinition> }) => {
  const navigate = useNavigate();
  const createRun = useCreateRun();

  const [scenarioId, setScenarioId] = createSignal(props.scenarios[0]?.scenarioId ?? '');
  const scenario = createMemo(() => props.scenarios.find((s) => s.scenarioId === scenarioId()));

  const [conditions, setConditions] = createSignal<ReadonlyArray<string>>([]);
  const [modelsText, setModelsText] = createSignal('');
  const [harnesses, setHarnesses] = createSignal<ReadonlyArray<string>>(['claude-cli']);
  const [extraHarness, setExtraHarness] = createSignal('');
  const [shape, setShape] = createSignal<ExecutionShape | ''>('');
  const [trialsPerCell, setTrialsPerCell] = createSignal(5);
  const [maxConcurrent, setMaxConcurrent] = createSignal(4);

  const toggleCondition = (label: string) => {
    setConditions((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );
  };
  const toggleHarness = (id: string) => {
    setHarnesses((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));
  };

  const models = createMemo(() =>
    modelsText()
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0),
  );

  const effectiveHarnesses = createMemo(() => {
    const extra = extraHarness().trim();
    return extra.length > 0 ? [...harnesses(), extra] : harnesses();
  });

  const canSubmit = createMemo(
    () =>
      scenario() !== undefined &&
      conditions().length > 0 &&
      models().length > 0 &&
      effectiveHarnesses().length > 0 &&
      shape() !== '' &&
      trialsPerCell() > 0,
  );

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    const s = scenario();
    const selectedShape = shape();
    if (s === undefined || selectedShape === '' || !canSubmit()) return;
    const config: RunConfig = {
      scenarioId: s.scenarioId,
      conditions: conditions(),
      models: models(),
      harnesses: effectiveHarnesses(),
      shape: selectedShape,
      trialsPerCell: trialsPerCell(),
      maxConcurrent: maxConcurrent(),
    };
    createRun.mutate(config, {
      onSuccess: (started) => navigate(`/runs/${started.runId}`),
    });
  };

  return (
    <form class={styles.form} onSubmit={onSubmit}>
      <h3 class={styles.heading}>Run trials</h3>

      <Select
        label="Scenario"
        value={scenarioId()}
        onChange={(value) => {
          setScenarioId(value);
          setConditions([]);
          setShape('');
        }}
        options={props.scenarios.map((s) => ({ value: s.scenarioId, label: s.title }))}
      />

      <Show when={scenario()}>
        {(s) => (
          <>
            <fieldset class={styles.field}>
              <legend class={styles.fieldLabel}>Conditions</legend>
              <div class={styles.checkGroup}>
                <For each={s().conditions}>
                  {(condition) => (
                    <label class={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={conditions().includes(condition.label)}
                        onChange={() => toggleCondition(condition.label)}
                      />
                      {condition.label}
                    </label>
                  )}
                </For>
              </div>
            </fieldset>

            <Select<ExecutionShape | ''>
              label="Shape"
              placeholder="Choose a shape…"
              value={shape()}
              onChange={setShape}
              options={s().declaredShapes.map((shapeOption) => ({
                value: shapeOption,
                label: shapeOption,
              }))}
            />
          </>
        )}
      </Show>

      <label class={styles.field}>
        <span class={styles.fieldLabel}>Models (comma-separated ids)</span>
        <input
          class={styles.input}
          type="text"
          placeholder="claude-sonnet-5, claude-opus"
          value={modelsText()}
          onInput={(e) => setModelsText(e.currentTarget.value)}
        />
      </label>

      <fieldset class={styles.field}>
        <legend class={styles.fieldLabel}>Harnesses</legend>
        <div class={styles.checkGroup}>
          <For each={WELL_KNOWN_HARNESSES}>
            {(id) => (
              <label class={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={harnesses().includes(id)}
                  onChange={() => toggleHarness(id)}
                />
                {id}
              </label>
            )}
          </For>
        </div>
        <input
          class={styles.input}
          type="text"
          placeholder="or a locally registered stub harness id"
          value={extraHarness()}
          onInput={(e) => setExtraHarness(e.currentTarget.value)}
        />
      </fieldset>

      <div class={styles.numberRow}>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Trials per cell</span>
          <input
            class={styles.input}
            type="number"
            min="1"
            value={trialsPerCell()}
            onInput={(e) => setTrialsPerCell(Number(e.currentTarget.value))}
          />
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Max concurrent</span>
          <input
            class={styles.input}
            type="number"
            min="1"
            value={maxConcurrent()}
            onInput={(e) => setMaxConcurrent(Number(e.currentTarget.value))}
          />
        </label>
      </div>

      <button type="submit" class={styles.submit} disabled={!canSubmit() || createRun.isPending}>
        {createRun.isPending ? 'Starting…' : 'Run trials'}
      </button>

      <Show when={createRun.isError}>
        <p class={styles.error}>{String(createRun.error?.message ?? 'Failed to start run')}</p>
      </Show>
    </form>
  );
};
