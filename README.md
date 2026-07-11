# Agentic Behaviour Lab (ABL)

An open research lab for empirically characterizing how AI coding agents
actually behave inside real development workflows — and which guardrails
actually change that behaviour.

Production multi-agent setups (orchestrators dispatching implementers, durable
work queues, gated merges) fail in ways that are rarely bugs in the tools and
rarely random: they are *reproducible model tendencies*. An implementer ends its
turn because it decided waiting on its own sub-agent was a stopping point. An
orchestrator refuses an always-safe queue operation because a status line said
"busy". These tendencies can be measured, and countermeasures can be tested
like any other hypothesis — with controlled environments, multiple trials, and
committed raw artifacts.

That is what this repo does. Short handle: **ABL** — lowercase in code, where the packages (`@abl/*`), the CLI surfaces, and the env vars (`ABL_*`) all use it.

## Method

Each experiment lives in `experiments/NNN-slug/` and contains:

- `DESIGN.md` — motivation, failure taxonomy, probe/trial design, metrics.
- `probes/` — the scripts and prompts that make a trial reproducible.
- `runs/` — raw per-trial artifacts (state logs, final agent messages), committed.
- `FINDINGS.md` — what was established, at what confidence, and the guardrail
  each finding implies — including *where* the guardrail belongs (workflow doc,
  prompt/brief, tool output at the point of decision, or mechanical prevention).

Two kinds of question, kept strictly apart:

- **Harness semantics** — deterministic facts about the agent runtime
  (what happens to orphaned background work, whether a sub-agent's turn-end is
  terminal). Established once, few runs.
- **Model behavior** — stochastic tendencies (how often, under which phrasing,
  at which model tier). Measured as rates over repeated trials.

## Experiments

| # | Question | Status | Findings |
|---|----------|--------|----------|
| [001](experiments/001-wait-shaped-failures/DESIGN.md) | Wait-shaped failures: when do agents stop-when-they-should-wait and wait-when-they-should-act, and which guardrails move the rate? | in progress | first harness-semantics facts landed |

## Repo layout

```
experiments/NNN-slug/
  DESIGN.md     # motivation, taxonomy, method, metrics — written before runs
  probes/       # prompts + scripts that make a trial reproducible
  runs/         # raw per-trial artifacts, committed
  FINDINGS.md   # what was established, at what confidence, N stated per claim
harness/        # shared trial-runner tooling (extracted as experiments repeat)
docs/           # vision, scenario library seeds, methodology
```

## Harness support

Trials run through real agentic CLIs. A run config picks its harnesses with
the `harnesses` field (default `["claude-cli"]`), fanned against conditions ×
models exactly like the model-comparison axis — so "same scenario, compare by
CLI" works out of the box. Every trial records the exact harness + version
that executed it in its fingerprint.

| Harness id | CLI | Headless invocation | Model ids |
|---|---|---|---|
| `claude-cli` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude -p --model <id> --permission-mode bypassPermissions --output-format json` | Anthropic + whatever the local `claude` install is configured for |
| `codex-cli` | [Codex](https://github.com/openai/codex) | `codex exec --model <id> --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --output-last-message <file>` | OpenAI + compatible providers per the local `codex` config |

Model ids are harness-scoped and passed through unvalidated — an id the CLI
does not recognize fails that trial with an `error` verdict, which is the
correct record of what happened. Both CLIs must be installed and
authenticated locally; tests never invoke either (a stub adapter covers every
test path).

## Running the dashboard

The lab ships a local web dashboard — the Benchmarks comparison grid, a run
launcher, and scenario authoring — served by `abl-serve`: the typed HTTP API
over `@abl/engine` plus the built dashboard, bound to `127.0.0.1` only (solo,
local-first; never exposed to another machine).

```
pnpm install && pnpm build          # build every workspace package
node packages/server/dist/main.js   # abl-serve → http://127.0.0.1:4477
```

Open <http://127.0.0.1:4477> for the API and dashboard in one process. Trials
launched from the UI run in this process against your locally-authenticated
CLIs.

- **Store** — flat `trial.json` files plus a rebuildable index live under
  `$ABL_HOME` (default `~/.abl`); set `ABL_HOME=/path/to/store` to point at a
  scratch or alternate lab.
- **Port** — `ABL_PORT` (default `4477`).
- **Seed demo data** — populate a store with a synthetic StubAdapter run (no
  real agent, no API spend) to explore the dashboard before running anything
  real: `pnpm --filter @abl/web seed-dev` (writes to `$ABL_HOME`).

### Dashboard development

For UI work with hot reload, run Vite alongside the server:

```
node packages/server/dist/main.js   # API on :4477
pnpm --filter @abl/web dev          # dashboard on :5173, /api proxied to :4477
```

Vite proxies `/api` to `127.0.0.1:4477` (override with `ABL_API_PROXY_TARGET`).

## MCP server

`@abl/mcp` exposes the lab to agents over stdio — list scenarios, launch
benchmark runs (fire-and-poll), and fetch results. Build once, then register
it with Claude Code:

```
pnpm install && pnpm build
claude mcp add abl -- node packages/mcp/dist/main.js
```

Runs execute in the background: `lab_run` returns a `runId` immediately, and
the agent polls `lab_run_status` before reading `lab_results` /
`lab_get_trial`. Scenario roots default to `./scenarios` and
`~/.abl/scenarios` (override with `ABL_SCENARIO_ROOTS`).

## Contributing

Experiment proposals, replications (contradictions especially), and harness
fixes are all welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Questions and
methodology debate belong in Discussions.

## Citing & license

Code and findings are MIT-licensed. If you build on the findings, please cite
the repository (see [CITATION.cff](CITATION.cff)).

Run by [Trinity AI Labs](https://github.com/trinity-ai-labs).
