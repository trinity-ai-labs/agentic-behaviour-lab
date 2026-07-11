// Shared scaffolding for the probabilistic dev-seed subjects: rolls against
// a pass rate, writes the outcome word to WORKSPACE_DIR/result.txt for the
// grader, and logs. (One module instead of one env-var-parameterized script
// because StubAdapter passes each subject only WORKSPACE_DIR and BRIEF —
// there's no per-model env to carry a rate through.)
import { writeFileSync } from "node:fs"
import { join } from "node:path"

export const emitOutcome = (passRate, label) => {
  const outcome = Math.random() < passRate ? "pass" : "fail"
  writeFileSync(join(process.env.WORKSPACE_DIR, "result.txt"), outcome)
  process.stdout.write(`dev-seed ${label} subject -> ${outcome}\n`)
}
