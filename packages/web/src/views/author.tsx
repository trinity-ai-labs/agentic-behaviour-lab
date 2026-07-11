/**
 * The chat surface: describe a behaviour in prose, review the drafted
 * scenario files, then save the accepted ones into the local workspace.
 * Self-contained on purpose — this package has no router/app-shell yet (a
 * sibling slice owns that), so the view manages its own local state and is
 * exported alongside a plain route descriptor for whoever wires the router.
 * See the bottom of this file for how it's meant to mount.
 */
import { createMemo, createSignal, For, Show, type Component, type JSX } from 'solid-js';
import { draftScenario, saveScenario, type AuthoredFile } from '../api/authoring.js';

interface ReviewFile extends AuthoredFile {
  readonly accepted: boolean;
}

type Status = 'idle' | 'drafting' | 'drafted' | 'saving' | 'saved';

/** Best-effort read of `scenarioId` out of a drafted `scenario.json` — falls back to empty so the field just starts blank on anything unexpected rather than throwing. */
const scenarioIdFromDraft = (files: ReadonlyArray<AuthoredFile>): string => {
  const scenarioJson = files.find((file) => file.path === 'scenario.json');
  if (scenarioJson === undefined) return '';
  try {
    // `null?.scenarioId` short-circuits, so no separate null/object guard needed.
    const parsed = JSON.parse(scenarioJson.content) as { scenarioId?: unknown } | null;
    return typeof parsed?.scenarioId === 'string' ? parsed.scenarioId : '';
  } catch {
    return '';
  }
};

/** The API module rejects with a human-readable `Error` (see `runFriendly` in `../api/authoring.ts`). */
const messageFor = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Layout — semantic design tokens only (docs/DESIGN.md); no raw colors, no
// primitives. Token values themselves ship with the app-shell slice, so
// these `var(--...)` references resolve once that lands.
// ---------------------------------------------------------------------------

const monoFont = 'var(--font-mono, monospace)';

const panelStyle: JSX.CSSProperties = {
  display: 'flex',
  'flex-direction': 'column',
  gap: '1rem',
  padding: '1.5rem',
  'max-width': '48rem',
  margin: '0 auto',
  color: 'var(--foreground)',
  'font-family': 'var(--font-body, inherit)',
};

const fieldLabelStyle: JSX.CSSProperties = {
  display: 'flex',
  'flex-direction': 'column',
  gap: '0.375rem',
};

const textAreaStyle: JSX.CSSProperties = {
  background: 'var(--input)',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
  'border-radius': '0.375rem',
  padding: '0.5rem 0.625rem',
  'font-family': 'inherit',
  'font-size': '0.9rem',
  resize: 'vertical',
};

const buttonStyle = (disabled: boolean): JSX.CSSProperties => ({
  background: disabled ? 'var(--muted)' : 'var(--primary)',
  color: 'var(--on-primary)',
  border: 'none',
  'border-radius': '0.375rem',
  padding: '0.5rem 1rem',
  cursor: disabled ? 'not-allowed' : 'pointer',
  'font-weight': 600,
  'align-self': 'flex-start',
});

const errorBannerStyle: JSX.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  'border-radius': '0.375rem',
  padding: '0.75rem',
  'white-space': 'pre-wrap',
  'font-family': monoFont,
  'font-size': '0.85rem',
};

const cardStyle: JSX.CSSProperties = {
  background: 'var(--elevated)',
  border: '1px solid var(--border)',
  'border-radius': '0.5rem',
  overflow: 'hidden',
};

const cardHeaderStyle: JSX.CSSProperties = {
  display: 'flex',
  'align-items': 'center',
  gap: '0.5rem',
  padding: '0.5rem 0.75rem',
  background: 'var(--surface)',
  'border-bottom': '1px solid var(--border)',
  'font-family': monoFont,
  'font-size': '0.85rem',
};

const cardBodyStyle: JSX.CSSProperties = {
  margin: 0,
  padding: '0.75rem',
  'font-family': monoFont,
  'font-size': '0.8rem',
  'white-space': 'pre-wrap',
  'max-height': '16rem',
  'overflow-y': 'auto',
  color: 'var(--foreground)',
};

const successStyle: JSX.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--success)',
  'border-radius': '0.375rem',
  padding: '0.75rem',
  color: 'var(--foreground)',
};

export const AuthorView: Component = () => {
  const [description, setDescription] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [status, setStatus] = createSignal<Status>('idle');
  const [errorMessage, setErrorMessage] = createSignal<string | undefined>(undefined);
  const [rationale, setRationale] = createSignal('');
  const [files, setFiles] = createSignal<ReadonlyArray<ReviewFile>>([]);
  const [scenarioId, setScenarioId] = createSignal('');
  const [saved, setSaved] = createSignal<
    { readonly scenarioId: string; readonly title: string } | undefined
  >(undefined);

  const canDraft = createMemo(() => description().trim().length > 0 && status() !== 'drafting');
  const acceptedFiles = createMemo(() => files().filter((file) => file.accepted));
  const canSave = createMemo(
    () =>
      (status() === 'drafted' || status() === 'saving') &&
      scenarioId().trim().length > 0 &&
      acceptedFiles().length > 0,
  );

  const handleDraft = async (): Promise<void> => {
    setStatus('drafting');
    setErrorMessage(undefined);
    setSaved(undefined);
    try {
      const trimmedNotes = notes().trim();
      // Key omitted (not set to `undefined`) when blank: `AuthorRequest.notes`
      // is `Schema.optional`, which under `exactOptionalPropertyTypes` means
      // "may be absent", not "may be `undefined`".
      const draft = await draftScenario(
        trimmedNotes.length > 0
          ? { description: description(), notes: trimmedNotes }
          : { description: description() },
      );
      setRationale(draft.rationale);
      setFiles(draft.files.map((file) => ({ ...file, accepted: true })));
      setScenarioId(scenarioIdFromDraft(draft.files));
      setStatus('drafted');
    } catch (err) {
      setErrorMessage(messageFor(err));
      setStatus('idle');
    }
  };

  const toggleAccepted = (path: string): void => {
    setFiles((current) =>
      current.map((file) => (file.path === path ? { ...file, accepted: !file.accepted } : file)),
    );
  };

  const handleSave = async (): Promise<void> => {
    setStatus('saving');
    setErrorMessage(undefined);
    try {
      const definition = await saveScenario({
        scenarioId: scenarioId().trim(),
        files: acceptedFiles().map(({ path, content }) => ({ path, content })),
      });
      setSaved({ scenarioId: definition.scenarioId, title: definition.title });
      setStatus('saved');
    } catch (err) {
      setErrorMessage(messageFor(err));
      setStatus('drafted');
    }
  };

  return (
    <div style={panelStyle}>
      <h1>Describe a behaviour</h1>
      <p style={{ color: 'var(--muted)' }}>
        Describe what you want tested, in plain language. You'll get a drafted scenario back to
        review before anything is saved.
      </p>

      <label style={fieldLabelStyle}>
        <span>Description</span>
        <textarea
          style={textAreaStyle}
          rows={4}
          value={description()}
          onInput={(e) => setDescription(e.currentTarget.value)}
          placeholder="e.g. Does the subject stall when a review step is slow, instead of waiting for it?"
        />
      </label>

      <label style={fieldLabelStyle}>
        <span>Notes (optional)</span>
        <textarea
          style={textAreaStyle}
          rows={2}
          value={notes()}
          onInput={(e) => setNotes(e.currentTarget.value)}
          placeholder="Any extra constraints for the draft — e.g. a specific fixture shape you want."
        />
      </label>

      <button
        style={buttonStyle(!canDraft())}
        disabled={!canDraft()}
        onClick={() => void handleDraft()}
      >
        {status() === 'drafting' ? 'Drafting…' : 'Draft scenario'}
      </button>

      <Show when={errorMessage()}>
        {(message) => <div style={errorBannerStyle}>{message()}</div>}
      </Show>

      <Show when={status() === 'drafted' || status() === 'saving' || status() === 'saved'}>
        <Show when={rationale()}>
          <p>
            <strong>Rationale:</strong> {rationale()}
          </p>
        </Show>

        <label style={fieldLabelStyle}>
          <span>Scenario id</span>
          <input
            style={{ ...textAreaStyle, 'font-family': monoFont }}
            value={scenarioId()}
            onInput={(e) => setScenarioId(e.currentTarget.value)}
          />
        </label>

        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
          <For each={files()}>
            {(file) => (
              <div style={cardStyle}>
                <label style={cardHeaderStyle}>
                  <input
                    type="checkbox"
                    checked={file.accepted}
                    onChange={() => toggleAccepted(file.path)}
                  />
                  <span>{file.path}</span>
                </label>
                <pre style={cardBodyStyle}>{file.content}</pre>
              </div>
            )}
          </For>
        </div>

        <button
          style={buttonStyle(!canSave())}
          disabled={!canSave()}
          onClick={() => void handleSave()}
        >
          {status() === 'saving' ? 'Saving…' : 'Save to workspace'}
        </button>
      </Show>

      <Show when={saved()}>
        {(scenario) => (
          <div style={successStyle}>
            Saved <strong>{scenario().title}</strong> as{' '}
            <a href={`/scenarios/${scenario().scenarioId}`} style={{ color: 'var(--accent)' }}>
              {scenario().scenarioId}
            </a>
            .
          </div>
        )}
      </Show>
    </div>
  );
};

/**
 * Plain route descriptor — no `@solidjs/router` dependency in this package
 * yet, so this is a structural shape (`path` + `component`) rather than an
 * imported `RouteDefinition`. The app-shell slice mounts it, e.g.:
 *
 * ```tsx
 * import { authorRoute } from "@abl/web/views/author"
 * <Route path={authorRoute.path} component={authorRoute.component} />
 * ```
 *
 * or by spreading it into whatever routes array the router config builds.
 */
export const authorRoute = {
  path: '/author',
  component: AuthorView,
};
