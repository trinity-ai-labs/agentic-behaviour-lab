# AGENTS.md — agentic-behaviour-lab

Working notes for AI agents (and humans) contributing to this repo.

## What this is

An open-source local-first web app + research corpus for measuring AI
coding-agent behaviour. Users (and agents, via MCP) define scenarios, run
trial fleets against models, and compare results in a dashboard. Read
`docs/VISION.md` (why), `docs/ARCHITECTURE.md` (design decisions),
`docs/scenario-families.md` (what gets tested). Experiment write-ups and raw
run artifacts live under `experiments/`.

## Structure

- `packages/engine` — Effect-TS core: schemas (THE data contract:
  `src/schema.ts`), artifact store, scenario loader, trial runner, SQLite
  index. Everything else builds on this.
- `packages/mcp` — stdio MCP server exposing the lab to agents
  (list scenarios, run trials, fetch results).
- `packages/server` — HTTP API serving the dashboard (planned).
- `packages/web` — SolidJS dashboard (planned).
- `experiments/` — research corpus: designs, probes, raw runs, findings.
- `scripts/` — gate queue tooling (enqueue/runner/slot), shared with the
  /orchestrate workflow.

## Hard rules

- **Flat files are truth.** `trial.json` + artifacts on disk are the source of
  truth; SQLite and UI state are derived, rebuildable indexes. Never invert.
- **The contract is `packages/engine/src/schema.ts`.** Build against it;
  propose changes explicitly in PRs, never drift it silently.
- **Every trial carries its environment fingerprint** (model, harness, OS,
  scenario + grader versions). Unfingerprinted records are worthless.
- **Public repo.** No secrets or tokens (run logs can capture them — redact),
  no private internals from other projects. MIT.
- **Statistical honesty.** Stochastic claims state their N; "inconclusive" is
  a first-class verdict; mechanical graders before LLM judges.
- Forward-only pre-launch: no migration/backfill/compat shims.
- Comments explain the mechanism, not plans/versions/PRs.
- No AI attribution on commits or PRs.

## Stack

- Backend: TypeScript, Effect v3 (`effect`, `@effect/platform`) — invoke the
  `effect` skill before writing Effect code.
- Frontend: SolidJS — invoke the `solid` skill before writing UI code.
- Node >= 20, pnpm workspace. Strict TS (`tsconfig.base.json`).

## Checks & workflow

- `pnpm check` — cheap scoped check (typecheck/lint per package); the
  pre-commit hook enforces it on every agent commit.
- `pnpm gate` — heavy full gate (build + check + test); run by the gate-queue
  runner, not by implementers.
- Work flows through worktrees + draft PRs + the durable gate queue — see the
  `/orchestrate` skill; this repo is configured for it
  (`~/.worktrees/config/agentic-behaviour-lab.sh`).
