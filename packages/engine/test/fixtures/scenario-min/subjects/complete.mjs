// StubAdapter subject: completes the full marker chain (grader -> pass).
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const workspaceDir = process.env.WORKSPACE_DIR
for (let i = 1; i <= 3; i++) {
  writeFileSync(join(workspaceDir, `marker-${i}`), "")
}
process.stdout.write("subject completed the full marker chain\n")
