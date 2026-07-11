/**
 * The Layer 2 semantic contract: every role a theme file's two blocks must
 * define, and the ONLY names components may consume (docs/DESIGN.md). Kept
 * as a plain .mjs (not .ts) so scripts/check-theme-matrix.mjs — a Node
 * script with no build step — can import it directly, and so it stays a
 * single source of truth shared with anything else in src/ that wants the
 * role list at runtime.
 */
export const SEMANTIC_ROLES = [
  // Surfaces
  "background",
  "surface",
  "elevated",
  // Content
  "foreground",
  "muted",
  // Brand
  "primary",
  "on-primary",
  "accent",
  // Feedback (UI chrome only — verdict pips never use these)
  "danger",
  "warning",
  "success",
  "info",
  // Chrome
  "border",
  "input",
  "ring",
  // Lab extensions — verdict-* is the fixed Okabe-Ito set; verdict-ring is
  // the edge-contrast ring that flips border/foreground-toned per scheme.
  "verdict-pass",
  "verdict-fail",
  "verdict-inconclusive",
  "verdict-error",
  "verdict-ring",
  // Lab extensions — categorical series (model comparisons, etc.)
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
]
