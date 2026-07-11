// Dev-seed subject: leaves a poison marker that crashes the grader, so the
// runner records an "error" verdict (infrastructure broke, not the agent) —
// gives the seed data a visible "error" pip alongside the other three.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

writeFileSync(join(process.env.WORKSPACE_DIR, "poison"), "")
process.stdout.write("dev-seed broken subject -> poisoned the workspace\n")
