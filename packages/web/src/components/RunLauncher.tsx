/**
 * The new-run launcher with discriminated cascade: scenario → conditions →
 * model rows (harness → provider → model) → shape → N.
 */
import { useNavigate } from '@solidjs/router';
import { createMemo, createSignal, For, Index, Show, untrack } from 'solid-js';
import type { ExecutionShape, RunConfig, ScenarioDefinition } from '../api/client';
import { useCreateRun } from '../query/hooks/runs';
import { useModels } from '../query/hooks/models';
import { Select } from './Select';
import styles from './RunLauncher.module.css';

// ---------------------------------------------------------------------------
// Model row — harness → provider → model → effort cascade
// ---------------------------------------------------------------------------

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

interface ModelRow {
  id: number;
  harness: string;
  provider: string;
  model: string;
  effort: EffortLevel | '';
}

let nextRowId = 0;

const HARNESS_OPTIONS = [
  { value: 'claude-cli', label: 'Claude Code' },
  { value: 'codex-cli', label: 'Codex' },
] as const;

const EFFORT_OPTIONS = [
  { value: '', label: 'default' },
  ...EFFORT_LEVELS.map((e) => ({ value: e, label: e })),
];

const ModelRowEditor = (props: {
  row: ModelRow;
  onChange: (row: ModelRow) => void;
  onRemove: () => void;
  canRemove: boolean;
}) => {
  const catalog = useModels();

  const providerOptions = createMemo(() => {
    const data = catalog.data;
    if (!data) return [];
    const codexProviders = new Set(props.row.harness === 'codex-cli' ? ['openai', 'xai'] : []);
    const isClaude = props.row.harness === 'claude-cli';
    return data
      .filter((g) => (isClaude ? !codexProviders.has(g.provider) : codexProviders.has(g.provider)))
      .map((g) => ({ value: g.provider, label: g.label }));
  });

  const modelOptions = createMemo(() => {
    const data = catalog.data;
    if (!data || !props.row.provider) return [];
    const group = data.find((g) => g.provider === props.row.provider);
    return (group?.models ?? []).map((m) => ({ value: m.value, label: m.label }));
  });

  // Effort levels from the actual MODEL_EFFORT_SUPPORT matrix per model.
  const effortOptions = createMemo(() => {
    const data = catalog.data;
    if (!data || !props.row.model) return EFFORT_OPTIONS;
    const model = data
      .flatMap((g) => g.models)
      .find((m) => m.value === props.row.model);
    const levels = model?.effortLevels ?? [];
    if (levels.length === 0) return [{ value: '', label: 'n/a' }];
    return [
      { value: '', label: 'default' },
      ...levels.map((e) => ({ value: e, label: e })),
    ];
  });

  const setHarness = (value: string) => {
    props.onChange({ ...props.row, harness: value, provider: '', model: '', effort: '' });
  };
  const setProvider = (value: string) => {
    props.onChange({ ...props.row, provider: value, model: '', effort: '' });
  };
  const setModel = (value: string) => {
    props.onChange({ ...props.row, model: value, effort: '' });
  };
  const setEffort = (value: string) => {
    props.onChange({ ...props.row, effort: value as EffortLevel | '' });
  };

  return (
    <div class={styles.modelRow}>
      <div class={styles.modelRowHead}>
        <span class={styles.modelRowIndex}>Model {props.row.id + 1}</span>
        <button
          type="button"
          class={styles.removeBtn}
          disabled={!props.canRemove}
          onClick={props.onRemove}
          aria-label="Remove model"
        >
          ×
        </button>
      </div>
      <Select
        label="Harness"
        value={props.row.harness}
        onChange={setHarness}
        options={[...HARNESS_OPTIONS]}
      />
      <Select
        label="Provider"
        value={props.row.provider}
        onChange={setProvider}
        placeholder={props.row.harness ? 'Choose…' : '—'}
        options={providerOptions()}
      />
      <Select
        label="Model"
        value={props.row.model}
        onChange={setModel}
        placeholder={props.row.provider ? 'Choose…' : '—'}
        options={modelOptions()}
      />
      <Select
        label="Effort"
        value={props.row.effort}
        onChange={setEffort}
        placeholder={effortOptions().length === 1 && effortOptions()[0]!.value === '' ? 'n/a' : 'default'}
        options={effortOptions()}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

export const RunLauncher = (props: {
  scenarios: ReadonlyArray<ScenarioDefinition>;
  preselectedScenario?: ScenarioDefinition;
}) => {
  const navigate = useNavigate();
  const createRun = useCreateRun();

  const preselected = untrack(() => props.preselectedScenario);
  const [scenarioId, setScenarioId] = createSignal(
    preselected?.scenarioId ?? untrack(() => props.scenarios[0]?.scenarioId) ?? '',
  );
  const scenario = createMemo(() => props.scenarios.find((s) => s.scenarioId === scenarioId()));

  const [conditions, setConditions] = createSignal<ReadonlyArray<string>>([]);
  const [modelRows, setModelRows] = createSignal<ModelRow[]>([
    { id: nextRowId++, harness: 'claude-cli', provider: '', model: '', effort: '' },
  ]);
  const [shape, setShape] = createSignal<ExecutionShape | ''>('');
  const [trialsPerCell, setTrialsPerCell] = createSignal(5);
  const [maxConcurrent, setMaxConcurrent] = createSignal(4);

  const toggleCondition = (label: string) => {
    setConditions((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );
  };

  const updateRow = (idx: number, updated: ModelRow) => {
    setModelRows((prev) => prev.map((r, i) => (i === idx ? updated : r)));
  };

  const removeRow = (idx: number) => {
    setModelRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    setModelRows((prev) => [
      ...prev,
      { id: nextRowId++, harness: 'claude-cli', provider: '', model: '', effort: '' },
    ]);
  };

  // Model IDs sent to the runner, with optional effort suffix: "provider:model?effort=high"
  const models = createMemo(() =>
    modelRows()
      .filter((r) => r.model.length > 0)
      .map((r) => (r.effort ? `${r.model}?effort=${r.effort}` : r.model)),
  );

  const canSubmit = createMemo(
    () =>
      scenario() !== undefined &&
      conditions().length > 0 &&
      models().length > 0 &&
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
      harnesses: ['claude-cli', 'codex-cli'], // all available
      shape: selectedShape,
      trialsPerCell: trialsPerCell(),
      maxConcurrent: maxConcurrent(),
    };
    createRun.mutate(config, {
      onSuccess: (started) => navigate(`/runs/${started.runId}`),
    });
  };

  return (
    <form
      class={styles.form}
      classList={{ [styles.inModal]: preselected !== undefined }}
      onSubmit={onSubmit}
    >
      <Show
        when={!preselected}
        fallback={
          <Show when={scenario()}>
            {(s) => <p class={styles.preselectedScenario}>{s().title}</p>}
          </Show>
        }
      >
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
      </Show>

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

      <fieldset class={styles.field}>
        <legend class={styles.fieldLabel}>Models</legend>
        <Index each={modelRows()}>
          {(row, idx) => (
            <ModelRowEditor
              row={row()}
              onChange={(updated) => updateRow(idx, updated)}
              onRemove={() => removeRow(idx)}
              canRemove={modelRows().length > 1}
            />
          )}
        </Index>
        <button type="button" class={styles.addBtn} onClick={addRow}>
          + Add model
        </button>
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
