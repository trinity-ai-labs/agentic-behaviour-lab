#!/usr/bin/env node
/**
 * Enforces docs/DESIGN.md's matrix-completeness rule: every
 * `[data-theme][data-scheme]` block in tokens/themes/*.css must define every
 * role in the semantic contract (src/tokens/contract.mjs), and each theme
 * file must contain exactly two blocks (a light + dark twin) — a
 * half-defined theme is a build error here, not a runtime surprise.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { SEMANTIC_ROLES } from "../src/tokens/contract.mjs"

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const themesDir = join(scriptDir, "..", "src", "tokens", "themes")

const BLOCK_HEADER = /\[data-theme="([^"]+)"\]\[data-scheme="([^"]+)"\]\s*\{/g
const CUSTOM_PROP = /--([a-z0-9-]+)\s*:/g

/** Splits a CSS file into its `[data-theme][data-scheme] { ... }` blocks (flat bodies, no nested braces). */
const parseBlocks = (css) => {
  const blocks = []
  let match
  BLOCK_HEADER.lastIndex = 0
  while ((match = BLOCK_HEADER.exec(css)) !== null) {
    const bodyStart = match.index + match[0].length
    const bodyEnd = css.indexOf("}", bodyStart)
    if (bodyEnd === -1) continue
    const body = css.slice(bodyStart, bodyEnd)
    const props = new Set()
    let propMatch
    CUSTOM_PROP.lastIndex = 0
    while ((propMatch = CUSTOM_PROP.exec(body)) !== null) props.add(propMatch[1])
    blocks.push({ theme: match[1], scheme: match[2], props })
  }
  return blocks
}

const themeFiles = readdirSync(themesDir).filter((f) => f.endsWith(".css"))
if (themeFiles.length === 0) {
  console.error(`check-theme-matrix: no theme files found under ${themesDir}`)
  process.exit(1)
}

const problems = []

for (const file of themeFiles) {
  const path = join(themesDir, file)
  const css = readFileSync(path, "utf8")
  const blocks = parseBlocks(css)

  if (blocks.length !== 2) {
    problems.push(`${file}: expected exactly 2 blocks (light + dark twin), found ${blocks.length}`)
    continue
  }

  const schemes = blocks.map((b) => b.scheme).sort()
  if (schemes.join(",") !== "dark,light") {
    problems.push(`${file}: expected one "light" and one "dark" block, found [${schemes.join(", ")}]`)
  }

  for (const block of blocks) {
    const missing = SEMANTIC_ROLES.filter((role) => !block.props.has(role))
    if (missing.length > 0) {
      problems.push(
        `${file} [data-theme="${block.theme}"][data-scheme="${block.scheme}"]: missing role(s): ${missing.join(", ")}`,
      )
    }
  }
}

if (problems.length > 0) {
  console.error("check-theme-matrix: theme × scheme matrix is incomplete:\n")
  for (const p of problems) console.error(`  ${p}`)
  console.error(`\n${problems.length} problem(s). Every theme × scheme block must define every semantic role.`)
  process.exit(1)
}

console.log(
  `check-theme-matrix: OK — ${themeFiles.length} theme file(s), ${SEMANTIC_ROLES.length} role(s), all blocks complete.`,
)
