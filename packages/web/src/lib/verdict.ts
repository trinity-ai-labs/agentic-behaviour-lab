/**
 * Verdict display metadata shared by every pip/legend/badge. Deliberately
 * carries no color — colors are semantic tokens (--verdict-*) selected in
 * CSS via `[data-verdict]`, never computed here (check-token-purity.mjs
 * would reject a literal anyway). Every verdict pairs a glyph with its label
 * so meaning never rides on color alone (docs/DESIGN.md).
 */
import type { VerdictOutcome } from "@abl/engine"

export interface VerdictMeta {
  readonly label: string
  /** Short glyph shown inside/beside a pip — never color-only signaling. */
  readonly glyph: string
}

export const VERDICT_META: Record<VerdictOutcome, VerdictMeta> = {
  pass: { label: "Pass", glyph: "✓" },
  fail: { label: "Fail", glyph: "✕" },
  inconclusive: { label: "Inconclusive", glyph: "◦" },
  error: { label: "Error", glyph: "‼" },
}

export const VERDICT_ORDER: ReadonlyArray<VerdictOutcome> = ["pass", "fail", "inconclusive", "error"]

/** Trials that have actually landed (produced any verdict) — the pip count a cell renders. */
export const landedCount = (counts: {
  readonly pass: number
  readonly fail: number
  readonly inconclusive: number
  readonly error: number
}): number => counts.pass + counts.fail + counts.inconclusive + counts.error
