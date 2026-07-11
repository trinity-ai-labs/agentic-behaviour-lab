// Stands up the hermetic workspace for mcp-min: a single seed file that
// proves the fixture stage ran before the subject touched anything.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.env.WORKSPACE_DIR;
if (!workspaceDir) {
  console.error('mcp-min fixture: WORKSPACE_DIR is not set');
  process.exit(1);
}

writeFileSync(join(workspaceDir, 'SEED.md'), 'mcp-min hermetic workspace\n');
