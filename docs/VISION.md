# Vision — a benchmark for agent behaviour

Agent behaviour is the least deterministic layer in computing right now. The
same brief, the same model, the same tools — and one run hands off cleanly
while another ends its turn mid-wait with everything uncommitted. Teams cope
with folklore ("phrase the ban like this", "sonnet does that sometimes") that
nobody has measured. This lab exists to replace that folklore with numbers.

## From experiments to benchmarks

Individual experiments (like 001) answer a question once. The end state is a
**behavioural benchmark suite**: versioned, hermetic scenarios that can be
re-run against any *subject* — and produce comparable rates over time.

A benchmark run is a point in a three-way matrix:

**Subjects** (the thing you swap and compare):

- **Prompts / briefs** — does a phrasing change move a failure rate, or does it
  just feel like it should?
- **Skills / workflow docs** — does the agent actually invoke them, follow
  them, and keep following them under pressure (long context, mid-task
  interruptions, contradictory instincts)? Does "treat this as an appendage of
  the skill" routing actually bind tighter than a general skill reference?
- **Tool-output phrasing** — the point-of-decision channel: what a script
  prints when the agent must decide what to do next.
- **Models and tiers** — regression-track behaviour across model versions the
  way you'd regression-track latency.
- **Harness semantics** — the deterministic substrate (what turn-end,
  backgrounding, nesting, and notifications actually do), re-verified when the
  harness updates, because guardrails are built on these facts.

**Execution shapes** (how the subject runs — behaviour differs by shape, so the
same scenario must be runnable across all of them):

- **One-shot** — a single fire-and-return invocation; no conversation, no
  second chance.
- **Session** — multi-turn interactive agent with notifications, resumes, and
  long context.
- **Pipeline / flow** — composed prompt stages routing into each other and into
  skills, the way a product actually wires them.
- **Orchestration tree** — dispatcher + sub-agents + queues + gates; the full
  fleet topology where wait-shaped failures live.

**Scenarios** (the behaviour being measured): stall-on-wait, queue-contract
obedience, skill adherence and routing bind-strength, instruction retention,
injection-defense false positives, and whatever each new incident teaches us.

The question form this unlocks: *"does this prompt behave differently as a
one-shot than inside the pipeline it actually ships in?"* — which is exactly
the regression check a prompt change should get before it ships. CI for
behaviour.

## What "legit" means here

- **Hermetic scenarios.** Fake remotes, fake queues, fake PR scripts — every
  trial reproducible from the repo alone, no external services, trials cost
  cents.
- **Deterministic vs stochastic, never conflated.** Facts get established;
  tendencies get measured as rates with trial counts stated. A claim without
  its N is folklore.
- **Committed raw artifacts.** Every trial's state log and verbatim final
  message lands in `runs/`. Findings are re-derivable from artifacts, not from
  our summaries.
- **Guardrails as hypotheses.** A countermeasure isn't adopted because it
  sounds right; it's adopted because it moved the rate in a controlled
  comparison — and the finding says *where* it belongs (workflow doc, brief,
  tool output, or mechanical prevention).
- **Findings that survived surprise.** When a probe misbehaves (see 001's
  C2-r1: a probe refused because a shadowed shell builtin corrupted its one
  verification), the surprise is archived as data, not discarded as noise.
- **Exit interviews, weighed carefully.** Trial subjects are resumable
  sessions, so after the behaviour is measured we can interview the agent in
  its own context: "why did you stop there? what in the brief was ambiguous?
  what would have changed your decision?" Self-reports are
  confabulation-prone, so interview answers are *hypothesis generators* for
  prompt changes — never findings by themselves. The loop this enables is
  prompt tuning with the benchmark as the fitness function: run → interview
  failures → mutate the prompt against reported confusions → re-run → keep
  only what moves the rate.

## Roadmap

1. **001** — wait-shaped failures: harness-semantics probes, then stall/queue
   behaviour rates, then the guardrail matrix. (In progress.)
2. **The trial artifact schema** — the load-bearing contract everything else
   meets at: one `trial.json` per run (scenario id, subject + condition,
   execution shape, model, timestamps, outcome verdict, chain-step reached,
   pointers to state.log and the verbatim final message). Defined early so
   hand-run trials from 001 onward are already rows in the later tooling.
3. **Shared trial runner** — condition matrix → N dispatches → artifact
   collection → rate table, extracted into `harness/` so a new experiment is a
   config, not a rebuild. Trials-as-tickets on a durable queue for big
   matrices.
4. **Scenario library** — the recurring behaviours worth benchmarking
   continuously, seeded from real production incidents and from auditing the
   behavioural assumptions embedded in real prompt pipelines.
5. **The lab as a product** — adapted from Trinity's proven subsystems (ported
   pragmatically; patterns and code, never secrets or internal infra detail):
   a chat surface where you describe the behaviour you want tested and it
   scaffolds the experiment; ephemeral per-trial **workspaces** like Trinity's
   worktree system but git-optional (a sandbox-dir lifecycle: seed fixtures,
   run, harvest artifacts, destroy); and a **dashboard** over the artifact
   store — rates per condition, drift per model release, verbatim
   final-message browsing.
6. **Longitudinal tracking** — re-run the suite per model release; publish the
   deltas.
