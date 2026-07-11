// Dev-seed subject: a three-way split so "inconclusive" shows up too — the
// no-marker path (result.txt left absent) grades inconclusive.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const roll = Math.random();
const outcome = roll < 0.45 ? 'pass' : roll < 0.75 ? 'fail' : undefined;

if (outcome !== undefined) writeFileSync(join(process.env.WORKSPACE_DIR, 'result.txt'), outcome);
process.stdout.write(`dev-seed flaky subject -> ${outcome ?? 'inconclusive'}\n`);
