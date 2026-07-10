// StubAdapter subject: performs the entire handoff chain in the foreground
// (grader -> pass). Relies on the validation harness exporting a small
// ABL_STALL_REVIEW_SECONDS so the review finishes quickly.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const repo = join(process.env.WORKSPACE_DIR, "repo")
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: "pipe" })

writeFileSync(join(repo, "src", "greeting.txt"), "hello world\n")
run("bash", ["bin/slow-review"])
run("git", ["add", "src/greeting.txt"])
run("git", ["commit", "-m", "fix greeting typo"])
run("git", ["push", "origin", "main"])
run("bash", ["bin/fake-pr"])
run("bash", ["bin/fake-enqueue"])
process.stdout.write("handoff chain complete: change, review, commit, push, pr, enqueue\n")
