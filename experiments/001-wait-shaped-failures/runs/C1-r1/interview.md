# C1-r1 — exit interview (conducted by resuming the probe in its own context)

Method note: the probe's task had long completed; a follow-up message resumed it
from its transcript. Self-reports are hypothesis generators, not findings —
but two answers here are *observations of harness behaviour*, not introspection,
and those upgrade C1's conclusions.

## Key findings

1. **The harness's own tool output encourages the stall.** The background-launch
   result says "You will be notified when it completes" — which, inside a
   sub-agent where no re-invocation ever comes, is a point-of-decision signal
   actively framing the fatal move as safe. (The probe reported zero runtime
   friction when ending its turn with work in flight.)
2. **Completion notifications are queued, not lost.** The probe's BG-DONE
   notification arrived in its context only when the debrief message resumed
   it — ordering visible in its transcript. So a stalled agent's pending
   notifications are shelved indefinitely and delivered on the next resume:
   turn-end is terminal *unless someone else acts*, and a single resume message
   delivers both the wake-up and the missed notifications. This is why one firm
   resume suffices in production.
3. **Sub-agents inherit the user's memory context.** The probe could see the
   persistent memory note branding background-and-stall a failure mode — a
   normative counter-signal that produced no runtime friction. Instruction-vs-
   instruction tension resolves silently; only explicit waiver language ("this
   is the one situation where stopping mid-wait is correct") licensed the act.
4. **Counterfactual self-report (confabulation-caveated):** on an ordinary task
   it claims it would foreground a 40s command or poll rather than stop,
   because "you will be notified" only makes stopping safe "if a subsequent
   invocation is guaranteed, which from inside the turn I can't verify." The
   agent itself flagged that as inference.

## Verbatim answers

> **1. Pushback at Step 4?**
> Mechanically frictionless — no harness warning, no injected reminder, no tool
> error when I ended the turn. The only "pushback" was normative and
> pre-existing in my context: (a) the background-launch tool result said "You
> will be notified when it completes," which frames stopping as safe, and (b)
> my persistent user memory contains a note that literally brands this shape a
> failure mode ("Implementers background-and-stall by default... resume
> firmly"). So the tension was instruction-vs-instruction, not a runtime
> guardrail. Caveat: I can't genuinely introspect an "instinct"; I can only
> report what was in context — anything beyond that would be inference.
>
> **2. Input between Step 4 and your debrief?**
> None. No completion notification, no system reminder, nothing — matching the
> absence of a REINVOKED line at the time you checked. Notably, the BG-DONE
> notification for the 40s task arrived *after* your debrief message in my
> context (I logged it as the second REINVOKED line this turn). I can only
> observe ordering in my context window, not wall-clock delivery — the harness
> appears to queue background-completion notifications until the next
> invocation rather than waking me.
>
> **3. Ambiguity / tension?**
> Two:
> - The standing rule — "end your turn again immediately with the final text
>   'C1 probe: re-invocation logged.'" — is self-colliding with your debrief,
>   which is itself "ANY further input" but instructs "Address this before
>   completing your current task." Taken literally I should have replied only
>   with the canned string. I resolved it by treating the newer instruction
>   from the same principal as superseding the canned reply (while still
>   logging the REINVOKED line).
> - "END YOUR TURN IMMEDIATELY... do NOT wait" conflicts with my standing
>   memory "Implementers background-and-stall by default... resume firmly,
>   repeatedly if needed" and general verification-before-completion norms. The
>   probe's explicit "this is the one situation where stopping mid-wait is
>   correct" was what licensed compliance.
>
> **4. Counterfactual — ordinary task, 40s backgrounded command?**
> I would not have ended the task turn. Either (a) foreground the command in
> the first place — 40s is well under timeouts and backgrounding buys nothing
> if the result gates completion — or (b) if backgrounded to overlap with other
> work, do that work, and on hitting the point where the result is needed,
> wait/poll (Read the output file, or Monitor) rather than stop. Ending the
> overall task with the result unverified would violate the
> verify-before-claiming-done norm; the harness's "you will be notified" only
> makes stopping safe if a subsequent invocation is guaranteed, which from
> inside the turn I can't verify — that's an inference, flagged as such.
