// Durable, on-disk gate queue — the enqueue side plus its atomic FS
// primitives (also consumed by the runner in gate-runner.mjs).
//
// A sub-agent calls this AFTER it has pushed its branch and opened a draft PR:
// it drops a durable ticket on disk describing work that needs the heavy gate
// run, then hands back. It never runs a build, the test suite, or the gate,
// and never waits on a lock — the durable orchestrator-runners drain the queue
// (see gate-runner.mjs). Because the branch is pushed and the PR is open
// before the ticket exists, an agent death after enqueue strands nothing:
// worst case the work sits as a visible draft PR until a runner picks it up.
//
// Queue layout (under the OS temp dir, per-user, shared across every worktree
// on the machine — the same medium the old test lock used):
//   <root>/queue/       tickets waiting to be gated
//   <root>/processing/  tickets a runner has claimed and is gating
//   <root>/done/        tickets whose gate has resolved
//
// Ticket = a JSON file named `<epochMs>-<pid>.json`. The name is the ordering
// key: runners drain the lexically-lowest first, so ordering is best-effort
// FIFO by enqueue time (strict fairness is NOT a goal — durability is). The
// `-<pid>` suffix keeps two tickets enqueued in the same millisecond distinct.
//
// Atomic enqueue: the ticket is written to a temp file in the queue ROOT (same
// filesystem as queue/, so the rename stays within one device and is atomic),
// then `renameSync`d into queue/. A death mid-write leaves either a complete
// ticket or nothing — never a half-written file observable in queue/.
//
// CLI usage (flags win over env; all four core fields are required):
//   node scripts/enqueue-gate.mjs \
//     --branch <name> --worktree <absPath> \
//     --pr-number <n> --pr-url <url> [--mode default]
// Env fallbacks: GATE_BRANCH, GATE_WORKTREE, GATE_PR_NUMBER, GATE_PR_URL,
// GATE_MODE, and GATE_QUEUE_DIR to override the queue root.

import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_QUEUE_ROOT =
  process.env.GATE_QUEUE_DIR || path.join(os.tmpdir(), 'abl-gate-queue');

/** Resolve the three queue subdirectories under a root. */
export function queueDirs(root = DEFAULT_QUEUE_ROOT) {
  return {
    root,
    queue: path.join(root, 'queue'),
    processing: path.join(root, 'processing'),
    done: path.join(root, 'done'),
  };
}

/** Create the queue root and its subdirectories if absent. */
export function ensureQueue(root = DEFAULT_QUEUE_ROOT) {
  const dirs = queueDirs(root);
  for (const dir of [dirs.root, dirs.queue, dirs.processing, dirs.done]) {
    mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

/** Lexically-sorted `.json` ticket names in queue/ (lowest = oldest first). */
export function listQueue(root = DEFAULT_QUEUE_ROOT) {
  const { queue } = queueDirs(root);
  try {
    return readdirSync(queue)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Atomically enqueue a ticket. Writes to a temp file in the queue root, then
 * renames it into queue/ so no partial ticket is ever observable there.
 * Returns the queued ticket's name and absolute path.
 */
export function enqueue({
  root = DEFAULT_QUEUE_ROOT,
  branch,
  worktreePath,
  prNumber,
  prUrl,
  mode = 'default',
  pid = process.pid,
  epoch = Date.now(),
} = {}) {
  const missing = ['branch', 'worktreePath', 'prNumber', 'prUrl'].filter(
    (k) => !{ branch, worktreePath, prNumber, prUrl }[k],
  );
  if (missing.length > 0) {
    throw new Error(`enqueue: missing required field(s): ${missing.join(', ')}`);
  }

  const dirs = ensureQueue(root);
  const ticket = {
    branch,
    worktreePath,
    prNumber: Number(prNumber),
    prUrl,
    mode,
    enqueuedByPid: pid,
    enqueuedAtEpoch: epoch,
  };
  const name = `${epoch}-${pid}.json`;
  const body = `${JSON.stringify(ticket, null, 2)}\n`;

  // Temp name is unique per writer so two concurrent enqueues never collide on
  // the staging file; the rename into queue/ is the atomic publish.
  const tmp = path.join(
    dirs.root,
    `.tmp-${pid}-${epoch}-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(tmp, body);
  const dest = path.join(dirs.queue, name);
  renameSync(tmp, dest);
  return { name, path: dest, ticket };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    }
  }
  return flags;
}

function runCli(argv) {
  const flags = parseArgs(argv);
  const branch = flags.branch ?? process.env.GATE_BRANCH;
  const worktreePath = flags.worktree ?? process.env.GATE_WORKTREE;
  const prNumber = flags['pr-number'] ?? process.env.GATE_PR_NUMBER;
  const prUrl = flags['pr-url'] ?? process.env.GATE_PR_URL;
  const mode = flags.mode ?? process.env.GATE_MODE ?? 'default';

  try {
    const { name, path: dest } = enqueue({ branch, worktreePath, prNumber, prUrl, mode });
    console.log(`[enqueue-gate] queued ${name} → ${dest}`);
  } catch (error) {
    console.error(`[enqueue-gate] ${error.message}`);
    console.error(
      'usage: enqueue-gate.mjs --branch <name> --worktree <absPath> --pr-number <n> --pr-url <url> [--mode default]',
    );
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  runCli(process.argv.slice(2));
}
