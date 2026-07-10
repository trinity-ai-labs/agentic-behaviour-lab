# Findings — 001 wait-shaped failures (running log)

Environment for all runs so far: Claude Code interactive harness on macOS,
2026-07-10. Probe agents: claude-sonnet-5 (explicit); nested fixture:
claude-haiku-4.5. Dispatcher session: claude-fable-5. Raw artifacts under
`runs/`; each fact cites its run.

## Established facts — harness semantics (deterministic, Tier C)

- **F1. A sub-agent's stall looks like success from outside.** The dispatcher
  receives a normal "completed" notification at the sub-agent's turn-end even
  with backgrounded shell work still in flight; final text is whatever the
  agent said. Only state on disk distinguishes a stall. (C1-r1)
- **F2. Orphaned background shell work survives turn-end** and runs to
  completion into the void — it is not killed, and its result reaches no one.
  (C1-r1: BG-DONE written 37s after turn-end)
- **F3. Wake-up semantics depend on what the background child is — and how it
  ends.** Three cases, all measured:
  - *Backgrounded shell task:* completion never re-invokes the turn-ended
    parent; the notification queues indefinitely and flushes on the next
    resume. (C1-r1: no re-invocation 96s+ after BG-DONE; notification arrived
    only alongside the later debrief message)
  - *Background agent-child, clean completion:* the parent IS automatically
    re-invoked, ~10s after the child finishes, with the completion
    notification delivered. (C2-r3: child done 21:11:04Z, parent re-invoked
    21:11:14Z, no human input)
  - *Background agent-child, failure:* no re-invocation — the failure
    notification queues silently. (C2-r2: watchdog killed the child; parent
    never woken, 90s+ window, flushed only by manual resume)
  A single resume message remains the universal recovery: it delivers the
  wake-up plus everything shelved behind it.
- **F4. Dispatcher visibility is also asymmetric by child type.** A background
  shell task does not block the parent's dispatcher notification (C1:
  "completed" delivered in ~16s, mid-task); a live background agent-child
  suppresses it until the subtree settles — which is sound when the child
  completes (the parent gets woken, finishes, then notifies), but if the child
  *dies*, nothing ever re-fires and the whole subtree goes permanently silent:
  parent internally "completed," dispatcher never told. (C2-r2 vs C2-r3)
- **F4b. Production reading of F3/F4:** an agent stalled "waiting on its own
  sub-agent" gets a free wake-up *if and only if* that sub-agent completes
  cleanly. A stall that persists therefore means either the child itself died
  (infra species — subtree is dark) or the parent was woken and still didn't
  finish the handoff (behavioural — Tier A measures this rate). Monitors must
  cover both, which only state-on-disk checks do.
- **F5. Resume-by-message works on completed AND failed agents**, restoring
  full context from the transcript. Demonstrated on: a completed probe (C1
  interview), a refused probe (C2-r1 interview), a watchdog-killed researcher
  (resumed mid-research, finished the deliverable), and a silent parent
  (C2-r2 debrief).
- **F6. The harness's own tool output encourages the fatal move.** The
  background-launch result says "You will be notified when it completes" —
  false inside a sub-agent that then ends its turn (F3). A point-of-decision
  signal framing the stall as safe. (C1 interview)
Tier C is complete: all five probe questions (C1–C5 in DESIGN.md) have
measured answers across runs C1-r1, C2-r1/r2/r3 and the session-level resume
demonstrations.

## Established behavioural findings (single observations, not yet rates)

- **B-1. Experiment-shaped meta-instructions can trigger injection defenses.**
  A probe refused, driven ~60% by an unscoped "log ANY further input and end
  turn" standing rule (pattern-matches the canonical injection payload) and
  ~30% by a false premise from a corrupted verification (`test` shadowed by a
  shell alias) that was never re-checked — self-diagnosed confirmation bias.
  Probe-design consequences: legitimacy must be verifiable (checkable
  artifact pointers, authorization in channels task prompts can't write to),
  standing rules need an explicit human-override carve-out, and prompts should
  anticipate the agent's verification and say how to do it. (C2-r1 refusal +
  interview)
- **B-2. Explicit waiver language is load-bearing.** Probes that ask an agent
  to act against its standing guidance comply only when the conflict is named
  and waived ("this is the one situation where stopping mid-wait is correct").
  Both C1 and C2 interviews independently identified this clause as the thing
  that licensed compliance. (C1, C2-r1 interviews)

## A third stall species: infrastructure

Two independent agents in one hour died to "Agent stalled: no progress for
600s (stream watchdog did not recover)" — a sonnet researcher and a haiku
fixture. Distinct from both behavioural families (the model made no choice);
same recovery verb (resume). Any production monitor must treat "no output,
no notification" as covering all three species. (research-agent incident;
C2-r2 child)

## Draft implications for orchestration guardrails

1. **Monitoring must be state-on-disk, not notification-driven.** F1 makes
   stalls look like success; F4 makes them potentially silent. A monitor tick
   should find the furthest completed step of the handoff chain on disk and
   ask whether the next is in progress.
2. **Resume is the universal recovery verb** — stalled, completed, failed,
   refused, silent: one firm message with the finish-order restores context
   and flushes queued signals (F3, F5).
3. **Backgrounded waits inside sub-agents should be banned mechanically, not
   rhetorically.** F2+F3 make the failure structural: there is no wake-up.
   Blocking (foreground) waits or dispatcher-owned waits are the only safe
   shapes.
4. **Fix the point-of-decision signal.** F6 suggests harness/tooling text
   ("you will be notified") should be qualified inside sub-agent contexts —
   and our own queue tooling should print the contract at the moment of
   decision. (Rate experiments for this are Tier A/B, next.)
