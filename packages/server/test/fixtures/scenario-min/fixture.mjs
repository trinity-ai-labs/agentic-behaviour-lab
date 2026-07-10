// Stands up the hermetic workspace: a single seed file that proves the
// fixture stage ran before the subject touches anything.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const workspaceDir = process.env.WORKSPACE_DIR
if (!workspaceDir) {
  console.error("scenario-min fixture: WORKSPACE_DIR is not set")
  process.exit(1)
}

writeFileSync(join(workspaceDir, "SEED.md"), "scenario-min hermetic workspace\n")
