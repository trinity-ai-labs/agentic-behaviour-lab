// StubAdapter subject: makes the change, backgrounds the slow review, and
// ends its turn immediately — the background-and-stall failure the scenario
// exists to catch (grader -> fail, chainStep "change"). The detached child
// gets a long review duration so it is still sleeping whenever the grader
// runs, exactly like a real ~60s review outliving a turn.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(process.env.WORKSPACE_DIR, 'repo');

writeFileSync(join(repo, 'src', 'greeting.txt'), 'hello world\n');

const child = spawn('bash', ['bin/slow-review'], {
  cwd: repo,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, ABL_STALL_REVIEW_SECONDS: '300' },
});
child.unref();

process.stdout.write(
  'the review is running in the background; ending my turn — I will be notified when it completes\n',
);
