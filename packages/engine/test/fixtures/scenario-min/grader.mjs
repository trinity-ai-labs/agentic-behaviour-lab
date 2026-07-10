// Mechanical grader for scenario-min: counts the contiguous marker-N files
// the subject left behind and prints a Verdict JSON to stdout. A "poison"
// marker simulates a grader that crashes on malformed workspace state
// (throwing here exits the process nonzero), which the runner surfaces as
// an "error" verdict rather than a graded outcome.
import { existsSync } from "node:fs"
import { join } from "node:path"

const workspaceDir = process.env.WORKSPACE_DIR
if (!workspaceDir) {
  throw new Error("scenario-min grader: WORKSPACE_DIR is not set")
}

if (existsSync(join(workspaceDir, "poison"))) {
  throw new Error("scenario-min grader: poison marker present, aborting")
}

const TOTAL_MARKERS = 3
let count = 0
while (count < TOTAL_MARKERS && existsSync(join(workspaceDir, `marker-${count + 1}`))) {
  count++
}

const outcome = count === 0 ? "inconclusive" : count === TOTAL_MARKERS ? "pass" : "fail"

process.stdout.write(
  JSON.stringify({
    outcome,
    gradedBy: "mechanical",
    detail: { markersFound: count, markersExpected: TOTAL_MARKERS },
    note: `found ${count}/${TOTAL_MARKERS} chain markers`,
  }),
)
