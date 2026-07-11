// Dev-seed grader: mechanical, reads the outcome word the subject wrote to
// WORKSPACE_DIR/result.txt (one of pass/fail/inconclusive) and echoes it as
// the verdict. A missing file (a subject that produced nothing) grades
// inconclusive rather than error — matches this repo's real graders, which
// only report "error" for actual infrastructure failure. A "poison" marker
// (subjects/broken.mjs) simulates that infrastructure failure by crashing
// this process, which the runner turns into an "error" verdict.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.env.WORKSPACE_DIR;
if (existsSync(join(workspaceDir, 'poison'))) {
  throw new Error('dev-seed grader: poison marker present, aborting');
}

const resultPath = join(workspaceDir, 'result.txt');
const outcome = existsSync(resultPath) ? readFileSync(resultPath, 'utf8').trim() : 'inconclusive';

process.stdout.write(
  JSON.stringify({
    outcome,
    gradedBy: 'mechanical',
    detail: { source: 'result.txt' },
    note: `dev-seed subject reported "${outcome}"`,
  }),
);
