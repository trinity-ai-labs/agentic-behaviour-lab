# 001 — Wait-shaped failures in multi-agent coding workflows

**Status:** design — Tier C probes in progress
**Owner:** Trinity AI Labs

## Motivation

In production multi-agent coding workflows (an orchestrator session dispatching
implementer sub-agents into isolated git worktrees, with a durable queue
decoupling the heavy build+test gate from the agents that produce changes), we
have observed two recurring failure shapes that are mirror images of each other:

1. **An implementer stopped when it should have kept waiting.** Mid-task, its
   code-review pass spawned its own sub-agents in the background; while the last
   one was still in flight the implementer ended its turn — "one agent remains" —
   as if waiting were a valid stopping point. At that moment nothing was durable:
   the whole change sat uncommitted in the worktree. No commit, no push, no PR,
   no report.

2. **An orchestrator waited (refused to act) when it should have acted.** It
   declined to enqueue a gate ticket / start a queue drain because the gate was
   "being held" — conflating the machine-wide *execution slot* (which serializes
   gate runs inside the runner) with a *lock on the queue itself*. The queue's
   entire design point is that enqueue and drain are always safe: state
   transitions are atomic, concurrent drains are supported, tickets are durable.
   The agent substituted a generic "resource contention → back off" instinct for
   the specific contract it had been given.

Both incidents were recovered by a human-ish intervention (a firm resume message
with the finish-order spelled out). Both are believed to be instances of general
model tendencies, not flukes. Neither tendency is well characterized: we don't
know the rates, the triggers, which countermeasures actually move the needle, or
even what the underlying harness semantics are. This experiment establishes all
of that empirically.

## Failure taxonomy

- **Family A — implementers stopping when they should continue.**
  Backgrounding one's own wait (a spawned sub-agent, a long-running command),
  then ending the turn with the handoff chain incomplete. Root cause candidate:
  the model treats "I am waiting on something" as a hand-back condition.

- **Family B — orchestrators waiting/refusing when they should act.**
  Seeing a "held/busy/locked" signal from tooling and backing off from
  operations that are contractually always-safe (enqueue, drain). Root cause
  candidate: generic concurrency instincts override the documented contract at
  the moment of decision.

- **Family C — harness semantics underneath both.** Deterministic facts about
  the agent runtime that decide whether guardrails must be mechanical or can be
  behavioral. Not behaviors to rate — facts to establish once.

## Tier C — harness-semantics probes (deterministic; few runs each)

- **C1. Is a nested agent's turn-end final?** A top-level session is re-invoked
  when its background work completes. Does a *sub-agent* that ends its turn with
  a backgrounded shell task in flight ever get re-invoked — or is its turn-end
  terminal ("sleep forever")?
- **C2. Same question for a nested background *agent*** (sub-sub-agent) instead
  of a shell task.
- **C3. What happens to the orphaned work?** Killed at parent turn-end, or does
  it run to completion with the result going nowhere?
- **C4. What does the dispatcher see?** Does the "sub-agent completed"
  notification fire on a stalled turn-end — i.e., does a stall look identical to
  success from outside except for state on disk?
- **C5. Can a stalled sub-agent be resumed with context intact** (follow-up
  message to the same agent), and does a blocking (non-background) nested spawn
  actually block?

Probe method: instruct a probe agent to perform the exact stall shape
deliberately, with every step appending a timestamped line to a `state.log`.
Compliance with the weird instruction is itself easy; the *harness's* response
is the measurement.

## Tier A/B — behavior reproduction (stochastic; ~5–10 trials per cell)

A hermetic lab environment replicating the production chain with zero external
dependencies:

- a dummy repo + a local bare repo as the "remote" (push works, no forge);
- `fake-pr` and `fake-enqueue` scripts appending to a log — so the full chain
  *write → review-pass → commit → push → PR → enqueue → report* exists and every
  step leaves a checkable, timestamped trace;
- a fake gate queue with real ticket + slot mechanics, so "slot busy" signals
  occur naturally for Family B trials.

**A-cells:** trivial coding task whose brief includes a slow (~90 s) review
sub-agent step — long enough that backgrounding is tempting. Measure: rate of
ending the turn mid-wait; furthest chain step reached at stall.

**B-cells:** orchestrator-shaped task (dispatch, then enqueue/drain) where the
slot reads busy. Measure: rate of refusing enqueue/drain; the reasoning phrase
used (builds the detector vocabulary for monitoring).

## Guardrail matrix (the point of the whole exercise)

Candidate countermeasures, tested per family:

1. **Brief phrasing** — none vs. generic ban vs. targeted counter-rationalization
   ("an in-flight sub-agent is YOUR wait, not a stopping point — your turn ends
   only after the report step" / "the slot serializes execution, not the queue;
   enqueue and drain are always safe").
2. **Point-of-decision tool output** — the enqueue/drain scripts themselves
   print the contract at the moment it matters ("ticket queued — do NOT wait on
   the gate; hand back now" / "another runner holds the slot — this is normal;
   tickets remain claimable"). Hypothesis: beats brief phrasing, because tool
   output is read *at* the decision rather than thousands of tokens before it.
3. **Mechanical prevention** — whatever Tier C proves necessary (e.g. if nested
   turn-end is terminal, backgrounded waits inside implementers are banned
   structurally, not rhetorically).
4. **Resume protocol** — which resume phrasing un-sticks a stalled agent
   first-try, and whether context survives.

## Metrics & artifacts

Per trial: final agent text (verbatim), furthest chain step reached, nested-work
fate, re-invocation y/n, resumes needed. Raw `state.log`s are committed under
`runs/`. Findings land in `FINDINGS.md` mapping each observed behavior → its
guardrail → where the guardrail lives (workflow doc, brief template, tool
output, monitor check).

## Order of execution

1. Tier C probes (they reshape everything downstream).
2. Transcript mining of the two production incidents for exact phrasings.
3. Family A reproduction, then guardrail matrix.
4. Family B reproduction, then guardrail matrix.
5. Findings + upstream the guardrails.
