#!/usr/bin/env node
/**
 * Enforces docs/DESIGN.md's Layer 3 rule: components consume semantic
 * tokens only. Walks every file under src/ EXCEPT src/tokens/ (where raw
 * color material legitimately lives) and fails if any file contains:
 *
 *   1. a raw hex color literal (`#0e1219`, `#fff`), or
 *   2. a raw `oklch(...)` function call, or
 *   3. a reference to a Layer-1 primitive color ramp (`--prim-*`, via
 *      `var(--prim-...)` or a bare declaration).
 *
 * Geometry/typography primitives (--space-*, --radius-*, --text-*,
 * --font-*) are deliberately NOT flagged — they are theme-agnostic by
 * construction (identical regardless of data-theme/data-scheme) and are
 * meant for direct component use; only the `--prim-` COLOR ramp is
 * reserved for theme authoring. See tokens.primitives.css's header comment.
 */
import { readFileSync, readdirSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const packageRoot = join(scriptDir, "..")
const srcRoot = join(packageRoot, "src")
const tokensRoot = join(srcRoot, "tokens")

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".css"])

const HEX_LITERAL = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g
const OKLCH_LITERAL = /\boklch\(/g
const PRIM_TOKEN = /--prim-[a-z0-9-]+/g

/** Every scannable file under src/, excluding the src/tokens/ subtree. */
const scannableFiles = () =>
  readdirSync(srcRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((full) => full !== tokensRoot && !full.startsWith(tokensRoot + sep))

/** Every match of `pattern` in `text`, with its 1-based line number. */
const findLines = (text, pattern) => {
  const lines = text.split("\n")
  const hits = []
  lines.forEach((line, index) => {
    pattern.lastIndex = 0
    if (pattern.test(line)) hits.push({ line: index + 1, text: line.trim() })
  })
  return hits
}

const violations = []
for (const file of scannableFiles()) {
  const text = readFileSync(file, "utf8")
  const rel = relative(packageRoot, file)
  for (const [label, pattern] of [
    ["raw hex color literal", HEX_LITERAL],
    ["raw oklch() literal", OKLCH_LITERAL],
    ["Layer-1 primitive color token (--prim-*)", PRIM_TOKEN],
  ]) {
    for (const hit of findLines(text, pattern)) {
      violations.push(`${rel}:${hit.line}  [${label}]  ${hit.text}`)
    }
  }
}

if (violations.length > 0) {
  console.error("check-token-purity: found raw color / Layer-1 references outside src/tokens/:\n")
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    `\n${violations.length} violation(s). Components must consume semantic tokens only (docs/DESIGN.md Layer 3).`,
  )
  process.exit(1)
}

console.log("check-token-purity: OK — no raw color or Layer-1 primitive references outside src/tokens/.")
