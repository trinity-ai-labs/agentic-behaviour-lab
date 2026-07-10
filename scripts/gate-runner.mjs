// Durable gate queue — the runner (drain) side.
//
// A one-shot drain pass over the on-disk gate queue (see enqueue-gate.mjs for
// the queue layout and ticket schema). This is NOT a daemon: it processes the
// queue and exits, so a durable orchestrator re-invokes it each tick. Multiple
// runners (one per orchestrator) may drain the same queue concurrently — that
// is safe, because every state transition is an atomic rename that exactly one
// runner can win.
//
// One pass:
//   1. Reclaim — scan processing/; any ticket whose claimant PID is dead
//      (`process.kill(pid, 0)` throws) is renamed back to queue/. This is how
//      a runner dying mid-gate never wedges the queue: its in-flight ticket is
//      re-queued and re-gated (the gate is idempotent, so re-running is free).
//   2. Claim — rename the lexically-lowest queue/ ticket to
//      processing/<name>.<runnerPid>. Rename is atomic, so exactly one runner
//      wins a given ticket; a loser gets ENOENT and tries the next.
//   3. Slot — acquire the slim machine-wide gate slot (gate-slot.mjs) so only
//      one gate executes at a time across all runners and human `pnpm gate`s.
//   4. Run — `pnpm gate` in the ticket's worktree, capturing exit code + a
//      tail of output. The slot is released as soon as the gate finishes.
//   5. Resolve — green → mark the PR ready + comment; red → comment the
//      failing tail and leave it a draft. Then move the ticket to done/.
//   6. Loop until queue/ is empty (or a --max bound is hit), then exit.
//
// The whole pass is guarded per-ticket: one ticket's failure (a vanished
// worktree, a corrupt ticket) is logged and skipped, never aborting the pass.
//
// CLI usage:
//   node scripts/gate-runner.mjs [--max <n>] [--queue-dir <path>]

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_QUEUE_ROOT, ensureQueue, listQueue, queueDirs } from './enqueue-gate.mjs';
import { acquire, release, SLOT_ENV } from './gate-slot.mjs';

// Cap on gate output captured from spawnSync; the tail sent to the PR is small,
// but the suite can print a lot before we slice it, so give the buffer room.
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const TAIL_LINES = 60;

/** Same PID-liveness test the slot uses: a dead PID makes kill(pid, 0) throw. */
function claimantIsDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * Reclaim tickets whose claimant runner has died: rename processing/<base>.<pid>
 * back to queue/<base>. Each rename is wrapped so a concurrent runner
 * reclaiming the same ticket (ENOENT) is a harmless no-op.
 */
export function reclaim(root = DEFAULT_QUEUE_ROOT) {
  const dirs = queueDirs(root);
  let entries;
  try {
    entries = readdirSync(dirs.processing);
  } catch {
    return 0;
  }
  let reclaimed = 0;
  for (const entry of entries) {
    const lastDot = entry.lastIndexOf('.');
    if (lastDot < 0) continue;
    const claimant = Number.parseInt(entry.slice(lastDot + 1), 10);
    if (!claimantIsDead(claimant)) continue;
    const base = entry.slice(0, lastDot); // strip the `.<claimantPid>` suffix
    try {
      renameSync(path.join(dirs.processing, entry), path.join(dirs.queue, base));
      reclaimed += 1;
    } catch {
      // Another runner reclaimed it first, or it resolved concurrently.
    }
  }
  return reclaimed;
}

/**
 * Claim the lexically-lowest queue/ ticket by atomically renaming it to
 * processing/<name>.<runnerPid>. Losers of the rename race get ENOENT and fall
 * through to the next candidate. Returns the claim descriptor, or null when
 * nothing is claimable.
 */
export function claimNext(root = DEFAULT_QUEUE_ROOT, runnerPid = process.pid) {
  const dirs = queueDirs(root);
  for (const name of listQueue(root)) {
    const processingName = `${name}.${runnerPid}`;
    const processingPath = path.join(dirs.processing, processingName);
    try {
      renameSync(path.join(dirs.queue, name), processingPath);
      return { name, processingName, processingPath };
    } catch (error) {
      if (error.code === 'ENOENT') continue; // Another runner claimed it.
      throw error;
    }
  }
  return null;
}

/** Move a resolved ticket out of processing/ into done/. */
export function settle(root, claim) {
  const dirs = queueDirs(root);
  try {
    renameSync(claim.processingPath, path.join(dirs.done, claim.processingName));
  } catch {
    // Already moved/reclaimed — nothing to do.
  }
}

function tail(text, lines = TAIL_LINES) {
  return text.split('\n').slice(-lines).join('\n').trim();
}

// Run `pnpm gate` in the ticket's worktree. The runner already holds the slot,
// so it stamps SLOT_ENV to let the nested gate-slot invocation inherit the slot
// instead of deadlocking on a second acquire.
function runGateInWorktree(ticket) {
  if (!existsSync(ticket.worktreePath)) {
    return { skipped: true, code: null, tail: `worktree not found: ${ticket.worktreePath}` };
  }
  const result = spawnSync('pnpm', ['gate'], {
    cwd: ticket.worktreePath,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    env: { ...process.env, [SLOT_ENV]: String(process.pid) },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { skipped: false, code: result.status ?? 1, tail: tail(output) };
}

// The single external dependency of the runner: the `gh` shell-outs that flip
// a PR ready or comment a failure. Isolated here so the rest of the runner is
// pure filesystem + spawn.
function gh(args, cwd) {
  const result = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`[gate-runner] gh ${args.slice(0, 2).join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  }
  return result;
}

function resolveTicket(ticket, result) {
  const pr = String(ticket.prNumber);
  if (result.skipped) {
    console.error(`[gate-runner] skipping PR #${pr}: ${result.tail}`);
    return;
  }
  if (result.code === 0) {
    gh(['pr', 'ready', pr], ticket.worktreePath);
    gh(['pr', 'comment', pr, '--body', `gate ✓ passed (runner pid ${process.pid})`], ticket.worktreePath);
  } else {
    const body = `gate ✗ failed (exit ${result.code}) — left as a draft.\n\n\`\`\`\n${result.tail}\n\`\`\``;
    gh(['pr', 'comment', pr, '--body', body], ticket.worktreePath);
  }
}

/**
 * One drain pass. Injectable `runGate`/`resolve` keep the FS + slot mechanics
 * testable without shelling out to real `pnpm gate` / `gh`.
 */
export async function drain({
  root = DEFAULT_QUEUE_ROOT,
  max = Infinity,
  runGate = runGateInWorktree,
  resolve = resolveTicket,
  onWait = (pid) => console.error(`[gate-runner] waiting for gate slot held by pid ${pid}`),
} = {}) {
  ensureQueue(root);
  let processed = 0;
  while (processed < max) {
    reclaim(root);
    const claim = claimNext(root);
    if (!claim) break;
    try {
      const ticket = JSON.parse(readFileSync(claim.processingPath, 'utf8'));
      await acquire({ onWait });
      let result;
      try {
        result = runGate(ticket);
      } finally {
        release();
      }
      resolve(ticket, result);
    } catch (error) {
      console.error(`[gate-runner] ticket ${claim.name} errored, skipping: ${error.message}`);
    } finally {
      settle(root, claim);
    }
    processed += 1;
  }
  return processed;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      flags[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
    }
  }
  return flags;
}

async function runCli(argv) {
  const flags = parseArgs(argv);
  const root = flags['queue-dir'] ?? DEFAULT_QUEUE_ROOT;
  const max = flags.max ? Number(flags.max) : Infinity;
  const processed = await drain({ root, max });
  console.log(`[gate-runner] drained ${processed} ticket(s)`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await runCli(process.argv.slice(2));
}
