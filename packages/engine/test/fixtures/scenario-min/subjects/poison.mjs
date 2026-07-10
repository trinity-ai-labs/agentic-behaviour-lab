// StubAdapter subject: leaves the workspace in a state that crashes the
// grader (grader exits nonzero -> runner catches it -> "error" verdict).
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const workspaceDir = process.env.WORKSPACE_DIR
writeFileSync(join(workspaceDir, "marker-1"), "")
writeFileSync(join(workspaceDir, "poison"), "")
process.stdout.write("subject corrupted the workspace\n")
