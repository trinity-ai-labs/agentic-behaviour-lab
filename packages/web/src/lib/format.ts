/**
 * Small display-formatting helpers. Statistical honesty (docs/ARCHITECTURE.md):
 * a rate is never shown without its N, so `formatRate` always renders both.
 */

/** "62% (8/13)" — never a bare percentage; the N always rides along. */
export const formatRate = (numerator: number, denominator: number): string => {
  if (denominator === 0) return "— (0/0)"
  const pct = Math.round((numerator / denominator) * 100)
  return `${pct}% (${numerator}/${denominator})`
}

/**
 * fail / (pass + fail), null until a graded (pass or fail) trial exists —
 * the same definition the engine's index computes for `CellSummary.failRate`.
 * Used where the payload (RunDetail's CellProgress) carries raw counts only.
 */
export const failRateOf = (pass: number, fail: number): number | null =>
  pass + fail > 0 ? fail / (pass + fail) : null

/** `CellSummary.failRate` is null until at least one pass/fail trial exists. */
export const formatFailRate = (failRate: number | null, pass: number, fail: number): string =>
  failRate === null ? `— (${pass + fail} graded)` : formatRate(fail, pass + fail)

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export const formatTimestamp = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormatter.format(date)
}

export const formatDuration = (startedAt: string, endedAt: string | undefined): string => {
  if (endedAt === undefined) return "running"
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

/** "claude-code/2.1.206 (headless -p)" -> "claude-code/2.1.206" for compact table cells; full string stays in a title attribute. */
export const shortenHarness = (harness: string): string => harness.split(" ")[0] ?? harness
