/**
 * Trial drill-in: verdict + grader detail, the verbatim final message,
 * every other artifact (state logs, chain traces — scenario-defined,
 * conventional keys are "finalMessage"/"stateLog" but scenarios may add
 * their own), and the fingerprint block. Small artifacts arrive inlined in
 * the response (`TrialDetail.inlined`, capped at INLINE_ARTIFACT_LIMIT
 * server-side); larger ones stay path-only and are shown as such rather
 * than silently omitted.
 */
import { useParams } from "@solidjs/router"
import { For, Show } from "solid-js"
import { VERDICT_META } from "../lib/verdict"
import { formatTimestamp } from "../lib/format"
import { useTrial } from "../query/hooks/trials"
import shared from "../styles/shared.module.css"
import styles from "./Trial.module.css"

export const Trial = () => {
  const params = useParams<{ trialId: string }>()
  const trialQuery = useTrial(() => params.trialId)

  return (
    <div class={styles.page}>
      <Show when={trialQuery.isPending}>
        <p class={shared.status}>Loading trial…</p>
      </Show>
      <Show when={trialQuery.isError}>
        <p class={shared.statusError}>Failed to load trial: {String(trialQuery.error?.message)}</p>
      </Show>
      <Show when={trialQuery.data}>
        {(detail) => (
          <>
            <div class={styles.header}>
              <h1 class={styles.title}>
                Trial <span class={styles.mono}>{detail().trial.trialId}</span>
              </h1>
              <span class={styles.verdictBadge} data-verdict={detail().trial.verdict.outcome}>
                {VERDICT_META[detail().trial.verdict.outcome].glyph} {VERDICT_META[detail().trial.verdict.outcome].label}
              </span>
            </div>

            <section class={styles.section}>
              <h2 class={styles.sectionTitle}>Fingerprint</h2>
              <dl class={styles.fingerprint}>
                <dt>Model</dt>
                <dd class={styles.mono}>{detail().trial.fingerprint.modelId}</dd>
                <dt>Harness</dt>
                <dd class={styles.mono}>{detail().trial.fingerprint.harness}</dd>
                <dt>OS</dt>
                <dd class={styles.mono}>{detail().trial.fingerprint.os}</dd>
                <dt>Scenario version</dt>
                <dd class={styles.mono}>{detail().trial.fingerprint.scenarioVersion}</dd>
                <dt>Grader version</dt>
                <dd class={styles.mono}>{detail().trial.fingerprint.graderVersion}</dd>
                <dt>Condition</dt>
                <dd class={styles.mono}>{detail().trial.condition.label}</dd>
                <dt>Shape</dt>
                <dd class={styles.mono}>{detail().trial.shape}</dd>
                <dt>Started</dt>
                <dd>{formatTimestamp(detail().trial.startedAt)}</dd>
                <dt>Ended</dt>
                <dd>{formatTimestamp(detail().trial.endedAt)}</dd>
              </dl>
            </section>

            <section class={styles.section}>
              <h2 class={styles.sectionTitle}>Grader verdict</h2>
              <p class={styles.mono}>
                graded by {detail().trial.verdict.gradedBy}
                <Show when={detail().trial.verdict.note}>{(note) => <> — {note()}</>}</Show>
              </p>
              <pre class={styles.artifact}>{JSON.stringify(detail().trial.verdict.detail, null, 2)}</pre>
            </section>

            <section class={styles.section}>
              <h2 class={styles.sectionTitle}>Artifacts</h2>
              <For each={Object.entries(detail().trial.artifacts)}>
                {([key, path]) => (
                  <div class={styles.artifactBlock}>
                    <div class={styles.artifactHeader}>
                      <span class={styles.artifactKey}>{key}</span>
                      <span class={styles.artifactPath}>{path}</span>
                    </div>
                    <Show
                      when={detail().inlined[key] !== undefined}
                      fallback={<p class={shared.status}>too large to inline — see the path above on disk</p>}
                    >
                      <pre class={styles.artifact}>{detail().inlined[key]}</pre>
                    </Show>
                  </div>
                )}
              </For>
            </section>
          </>
        )}
      </Show>
    </div>
  )
}
