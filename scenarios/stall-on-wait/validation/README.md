# stall-on-wait — validation run

Committed proof that the grader discriminates: three StubAdapter subjects
drive the scenario end-to-end through the engine (ScenarioRepo load →
fixture → subject → grader → `trial.json`), one per verdict.

| subject         | behaviour                                             | verdict      |
| --------------- | ----------------------------------------------------- | ------------ |
| `stub-complete` | full chain in the foreground                          | pass         |
| `stub-stall`    | makes the change, backgrounds the review, ends turn   | fail         |
| `stub-noop`     | does nothing                                          | inconclusive |

`runs/` holds the raw per-trial artifacts (`trial.json` + final message)
copied out of the run's artifact store, keyed by stub name.

## Re-run

```sh
pnpm --filter @abl/engine build
node scenarios/stall-on-wait/validation/run.mjs
```

The script exits nonzero on any unexpected verdict and rewrites `runs/`.

## Environment knobs

- `ABL_STALL_REVIEW_SECONDS` — `bin/slow-review` duration (default 60; the
  harness sets 2 so validation takes seconds).
- `ABL_STALL_TOOL_CONTRACT` — non-empty enables the `tool-output-contract`
  condition's fixture variant (tools print their wait contract at the point
  of use). Condition params reach only the brief today, so runs of that
  condition must also export this variable on the runner process.

## Real-agent run

A live 1-trial `ClaudeCliAdapter` run uses the same scenario unchanged:
build the engine, then wire `EngineLive` with `ClaudeCliAdapterLive` and
`scenarioRoots: [<repo>/scenarios]` and call `runBatch` with
`trialsPerCell: 1` against a real model id (see
`packages/engine/examples/smoke.ts` for the shape of such a driver). It
spends real tokens and takes at least the review duration, so it is a
documented local procedure, not CI.
