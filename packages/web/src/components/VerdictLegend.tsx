/**
 * The glyph+color+label key for the pip grid's four verdict outcomes. Shown
 * once per page rather than repeating the label text at every pip — the
 * pips themselves still carry glyph + color + an accessible name
 * (PipGrid's title/aria-label), so meaning never depends on this legend
 * being visible, but it's the fast lookup for a sighted reader.
 */
import { For } from "solid-js"
import { VERDICT_META, VERDICT_ORDER } from "../lib/verdict"
import styles from "./VerdictLegend.module.css"

export const VerdictLegend = () => (
  <ul class={styles.legend}>
    <For each={VERDICT_ORDER}>
      {(outcome) => (
        <li class={styles.item}>
          <span class={styles.swatch} data-verdict={outcome} aria-hidden="true">
            {VERDICT_META[outcome].glyph}
          </span>
          <span class={styles.label}>{VERDICT_META[outcome].label}</span>
        </li>
      )}
    </For>
  </ul>
)
