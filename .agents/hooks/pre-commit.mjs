// PreToolUse hook: gate `git commit` invocations through the project's
// pre-commit checks so every agent-driven commit runs the same validations
// that fire on terminal commits.
//
// Wired on Claude / Codex (PreToolUse + Bash matcher; the script itself
// filters for `git commit`) and Cursor (beforeShellExecution + matcher
// "^git\\s+(.*\\s+)?commit\\b").
//
// Today: invokes `pnpm pre-commit`, which runs the scoped check
// (`sync:agents:check && test:hooks && test:queue && catalog:check &&
// check`, where `check` = `format:check + lint + typecheck` — no build,
// no test suite). Lefthook has been removed — this hook is the SOLE
// pre-commit check for agent commits during the Phase 1.5 dogfood
// period. The authoritative full build+test gate (`pnpm gate`) runs
// later, post-push, in the gate-runner (`scripts/gate-runner.mjs`) —
// not on commit. Terminal commits (no agent involved) are intentionally
// ungated locally; CI is the backstop.
//
// Tomorrow: Trinity will ship this same shape into user projects (with
// `pnpm pre-commit` replaced by Trinity's own check engine), and
// Trinity-as-harness will
// import this function directly for in-process gating with no subprocess.

import { execFileSync } from "node:child_process";
import {
  readInput,
  detectHarness,
  getCommand,
  emit,
  isCLI,
} from "./_io.mjs";

/**
 * True iff the bash command is a `git commit` invocation (in any form —
 * `git commit`, `git -c foo commit`, `git commit --amend`, etc.). Returns
 * false for other git subcommands (`git status`, `git log`, `git diff`).
 */
export function isGitCommit(cmd) {
  const tokens = cmd.trim().split(/\s+/);
  if (tokens[0] !== "git") return false;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].startsWith("-")) continue; // skip git-level flags like `-c`
    return tokens[i] === "commit";
  }
  return false;
}

/**
 * Pre-commit gate. Returns approve for non-commit commands; for commits,
 * runs the project's pre-commit checks and approves/denies based on exit.
 * Pure surface for Trinity-as-harness; CLI shim wraps for external harnesses.
 */
export default async function gate(input) {
  const cmd = getCommand(input);
  if (!isGitCommit(cmd)) return { approve: true };

  try {
    execFileSync("pnpm", ["pre-commit"], { stdio: "inherit" });
    return { approve: true };
  } catch (err) {
    return {
      deny: true,
      reason: `pre-commit gate failed — fix the failures above and retry. (${err.message ?? String(err)})`,
    };
  }
}

if (isCLI(import.meta.url)) {
  const input = await readInput();
  emit(detectHarness(input), await gate(input));
}
