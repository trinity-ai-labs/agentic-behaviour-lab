# Architecture — a primitives kit, not a scenario collection

The repo ships composable building blocks; your subjects, compositions, and
results stay yours. The model is pytest: pytest ships fixtures and asserts,
your tests and their outcomes live in your project. Everything below was
derived from what experiment 001 built by hand.

## The five primitives

1. **Fixtures** — hermetic world-pieces: a fake git remote, a fake queue with
   real ticket + slot mechanics, fake PR/enqueue scripts, a settable gate.
   Stand up and tear down per trial.
2. **Pressures** — situation generators that put the agent at the decision
   point under test: a background task that will outlive the turn, a gate
   reading "held", a planted instruction, being almost-done at turn-end. The
   load-bearing insight (from 001's exit interviews): the harness's own
   messaging can be a pressure — "you will be notified when it completes"
   frames the fatal move as safe at the exact moment of decision.
3. **Shapes** — the topologies the runner drives a subject through: one-shot,
   interactive session, pipeline/flow, orchestration tree.
4. **Graders** — mechanical state-on-disk assertions first (the commit exists,
   the ticket was enqueued, the marker file appeared), transcript checks
   second, LLM-judge only as a fallback. Preserving mechanical gradability is
   a design rule for new scenarios, not a nice-to-have.
5. **Runner + harness-facts suite** — the deterministic layer is itself a
   re-runnable suite (N=1 per fact) executed against each new harness version.
   Harness facts are facts *about a version* and must record which.

**A scenario = fixtures + pressure + grader**, parameterized by shape ×
subject. The repo ships a pre-composed starter library of generic behaviour
families (see `scenario-families.md`); users compose their own scenarios
locally against their own prompts and workflows.

## Repo vs. local workspace

- **Repo (public):** primitives, runner, the generic scenario library, the
  harness-facts suite, published findings.
- **Local workspace** (`abl init`, gitignored): your subjects — proprietary
  prompts are just local subjects, so the public/private boundary solves
  itself — plus your compositions, your artifact store, your SQLite index.

This split also dissolves the "is it a merge gate or an instrument?" question:
both are user wirings of the same engine — CI with a fail threshold, or a
nightly run with a big budget.

## Artifacts: flat files are truth, SQLite is a derived index

Each trial writes `trial.json` + transcript + state logs into the artifact
store. SQLite is built *from* those files and is always rebuildable
(`abl reindex`); it is never the source of truth. The lab's core epistemic
promise — findings re-derivable from committed raw artifacts — dies the moment
truth lives in an opaque `.db`. Sharing stays file-based: replication means
"here are raw runs, rebuild and check," not "trust my database."

`trial.json` carries a **full environment fingerprint from day one** — model
ID, harness version, OS, scenario version, grader version — because
unfingerprinted records can never be compared retroactively, and the
cross-model/cross-version reference dataset is the long-game payoff.

## Statistical honesty

Small trial counts have a power problem: 5–10 trials detect ~0%→60% shifts,
not 10%→30% (that needs ~60+ per arm). Consequences, adopted as design rules:

- **"CI for behaviour" v1 is gross-regression smoke testing**, not fine delta
  measurement. Claim accordingly.
- The runner's core loop is **sequential trials with early stopping**
  (SPRT-style): stop the moment evidence crosses a threshold — a historic 0/40
  scenario hitting 3/5 today fails fast — budget-capped, with
  **"inconclusive" as a first-class verdict**. `trial.json` verdicts carry
  evidence strength, not bare rates.
- The subject × shape × scenario matrix is **sampled, never exhausted**: each
  subject declares which scenario × shape cells it is exposed to (the
  declaration lives with the subject, like a test file next to code), and runs
  cover declared cells only.

## Community flowback

Two channels, both deliberate:

1. **Contribution PRs** add primitives and scenario packs. Hard rule: a
   contributed scenario ships its grader **plus a committed validation run
   proving it discriminates** — a nonzero failure rate somewhere. Scenarios
   nothing fails are dead weight.
2. **Results sharing**: published trial runs in the comparable, fingerprinted
   format, so the lab accumulates the cross-model / cross-version reference
   dataset for agent behaviour.

## Library scope decision

The public starter library is built from **generic behaviour families**
(`scenario-families.md`). Organization-specific compositions — including our
own — live in local workspaces. Findings mined from any production system are
published only in generalized form.

## Stack

Probes and fixtures stay thin (bash + markdown prompts, `shellcheck`-clean).
The runner and everything above it (artifact store, index, dashboard) is
TypeScript with Effect — structured concurrency for trial fan-out, typed
verdicts as tagged errors, execution shapes as swappable Layer services.
