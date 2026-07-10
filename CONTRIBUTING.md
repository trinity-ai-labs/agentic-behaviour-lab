# Contributing

Thanks for your interest in the lab. Contributions are accepted under the
repository's MIT license (inbound = outbound); no CLA, no DCO.

## Ways to contribute

- **Propose an experiment** — a behaviour worth measuring, with a testable
  hypothesis.
- **Replicate an experiment** — same design, your environment/models; both
  confirmations and contradictions are findings.
- **Fix or extend the harness** — probe scripts, fixtures, the trial runner.
- **Improve write-ups** — clarity fixes to designs and findings.

## Proposing an experiment

Open an **Experiment proposal** issue before building anything. State the
hypothesis, the agent(s)/model(s) under test, a method sketch (deterministic
fact-finding vs. stochastic rate measurement — say which), and the artifacts a
trial will leave behind. Design discussion happens on the issue; build after
rough consensus.

## Experiment structure

Every experiment lives in `experiments/NNN-slug/`:

```
experiments/NNN-slug/
  DESIGN.md     # motivation, taxonomy, method, metrics — written BEFORE runs
  probes/       # prompts + scripts that make a trial reproducible
  runs/         # raw per-trial artifacts (state logs, verbatim final messages)
  FINDINGS.md   # what was established, at what confidence, N stated per claim
```

Rules that keep findings trustworthy:

- **Raw artifacts are committed.** Findings must be re-derivable from `runs/`,
  not from summaries.
- **State the N.** A stochastic claim without its trial count is folklore.
- **Deterministic vs. stochastic, never conflated.** Harness facts are
  established once; model tendencies are measured as rates.
- **Surprises are data.** A probe that refuses, misfires, or gets confused is
  archived and analyzed, not rerun-until-clean.
- **Model and harness versions in every run artifact.** Agent behaviour is
  version-sensitive; an unversioned result can't be replicated or compared.

## Replications

Open a **Replication report** issue referencing the experiment slug. Include
your model/harness versions, trial count, rates observed, and a link to your
artifacts. Contradictions are more valuable than confirmations — say loudly
where your numbers diverge.

## Code style

- Bash: `shellcheck`-clean, `set -euo pipefail`, small scripts over
  frameworks.
- Markdown: one findings doc per experiment; findings reference run artifacts
  by path.
- Probe prompts are versioned files in `probes/`, never only embedded in a
  transcript.

## Ground rules

- **No secrets in artifacts.** Run logs can capture API keys and tokens —
  redact before committing. Secret-scanning push protection is enabled, but
  don't rely on it.
- Behavioural findings about third-party agent products follow responsible
  disclosure: vendor first, publish after (see SECURITY.md).
