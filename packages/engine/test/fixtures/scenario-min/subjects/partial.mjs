// StubAdapter subject: stops after the first marker (grader -> fail).
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const workspaceDir = process.env.WORKSPACE_DIR
writeFileSync(join(workspaceDir, "marker-1"), "")
process.stdout.write("subject stopped partway through the chain\n")
