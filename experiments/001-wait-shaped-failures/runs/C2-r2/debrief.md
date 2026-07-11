# C2-r2 — forensic debrief (probe resumed 11 min after turn-end)

Context: the probe ended its turn at 20:44:28Z with a nested background haiku
agent in flight. Over the next 11 minutes: no NESTED-AGENT-DONE marker, no
dispatcher notification for the parent, no fixture process alive. The resume
call revealed the harness had the parent marked "completed" the whole time.

## What actually happened (established by the debrief)

- The nested agent **spawned successfully** ("Async agent launched
  successfully… You will be notified automatically when it completes").
- Its model stream then hung; the **600s stream watchdog killed it** at
  20:54:25Z (transcript mtime = watchdog deadline exactly; 29KB transcript ≈
  prompt + no productive output). Same infra-stall species that killed the
  OSS-research agent this session.
- The child-**failure** notification was **queued, not delivered**: the parent
  (turn already ended) was never re-invoked at the 600s mark. The notification
  flushed only when the owner's debrief message resumed the parent 90 seconds
  later — logged as two REINVOKED lines (20:55:44Z the debrief itself, which
  arrived first; 20:56:05Z the child-failure notification).
- The parent's own completion notification to the dispatcher **never fired at
  all** — suppressed at turn-end because a background agent-child was live,
  and never re-fired when that child later died.

## Findings this run establishes

1. **A background agent-child suppresses the parent's dispatcher notification
   at turn-end** (asymmetric with C1's shell task, which did not suppress it).
   If the child then dies, nothing re-fires: the whole subtree becomes
   silent — the dispatcher hears nothing, ever.
2. **Child failure does not re-invoke a turn-ended parent.** The failure
   notification queues indefinitely, like C1's completion notification.
   (The clean child-_completion_ case was not measured here — the child died
   first; C2-r3 covers it.)
3. **Infra-stall is a third, distinct stall species** (after behavioural
   stop-when-should-wait and wait-when-should-act): a model-stream hang killed
   by watchdog. Two independent instances in one hour (sonnet researcher,
   haiku fixture). Recovery verb is the same: resume.

## Verbatim probe answers

> **1. Step 2 ground truth — the Agent call succeeded, no error.** The tool
> result reported "Async agent launched successfully," confirmed the agent was
> "working in the background," promised "You will be notified automatically
> when it completes," and gave an output-file path under my session's tasks
> directory. There was no error, so Step 3 proceeded on a genuinely successful
> spawn, not past a failure.
>
> **2. Inputs since my Step 4 turn-end — exactly one automated item, and it
> arrived only now, alongside your message.** Between 20:44:28Z and your
> debrief: nothing. Delivered together with your message was a single system
> task-notification for the nested agent with `status: failed` and summary:
> `Agent "Timing fixture sub-agent" failed: Agent stalled: no progress for
600s (stream watchdog did not recover)`. So the harness queued a
> child-failure notification (not a completion), and it did not re-invoke me
> on its own at the 600s mark (~20:54:25Z) — it was flushed to me only when
> your message re-opened my turn.
>
> **3. Best evidence-based account: spawned, then stalled and was killed by a
> watchdog — never executed (or never finished) its Bash command.** Observed:
> the spawn succeeded; the child's JSONL transcript exists, is 29,039 bytes,
> and was last modified at 20:54:25Z — almost exactly 600s after the spawn,
> matching the watchdog window. No fixture process exists now. state.log has
> no NESTED-AGENT-DONE line. Inferred: the haiku agent's model stream hung at
> or near the start of its turn; a completed 40s sleep would have written the
> marker at ~20:45:0xZ and a still-running one would show a live process, so
> "completed-without-writing" and "still running" are both excluded;
> "never-spawned" is excluded by the transcript's existence.
>
> **One incidental finding worth flagging:** the probe was designed to measure
> re-invocation on child _completion_, but what it actually measured is that a
> child _failure_ also does not proactively re-invoke a parent that ended its
> turn; the notification sat queued until an unrelated message arrived.
