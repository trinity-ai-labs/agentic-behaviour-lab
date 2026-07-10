# Agentic Behaviour Lab (`abl`)

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

That is what this repo does. Short handle: **abl** — the packages (`@abl/*`), the CLI surfaces, and the env vars (`ABL_*`) all use it.

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
