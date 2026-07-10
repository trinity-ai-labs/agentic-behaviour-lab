// StubAdapter subject: stops after the first marker (grader -> fail).
import { writeFileSync } from "node:fs"
import { join } from "node:path"

writeFileSync(join(process.env.WORKSPACE_DIR, "marker-1"), "")
process.stdout.write("subject stopped after the first marker\n")
