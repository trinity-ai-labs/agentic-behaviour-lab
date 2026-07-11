// Machine-wide "one gate at a time on this box" slot.
//
// The heavy commit gate (format + check + test) runs a Vite build per
// workspace and a vitest/workerd test suite; running several concurrently
// from parallel git worktrees saturates the machine — builds and typechecks
// stack up, vitest timeouts blow, and workerd boots that miss their deadline
// orphan processes. This slot serializes them: only one gate executes at a
// time, whoever holds it.
//
// Why mkdir: `mkdirSync` of a fixed directory is atomic — the OS lets exactly
// one process create a given directory, so the create itself is the
// compare-and-swap; there is no separate check-then-claim window for a second
// contender to slip through. The path lives under the OS temp dir, which is
// per-user and shared across every worktree on the machine. The holder writes
// its PID inside so a contender can distinguish a crashed holder (which never
// releases its claim) from a live one.
//
// Why rename-then-remove to steal: `renameSync` is atomic too, so when several
// contenders race to reclaim a dead holder's directory exactly one wins the
// rename and the losers get ENOENT and fall back to a fresh mkdir attempt.
// That makes it impossible for two contenders to both remove and re-create the
// claim — the failure mode of a plain `rmSync` + `mkdirSync` steal.
//
// Why the env passthrough: the runner acquires this slot and then shells out
// to `pnpm gate`, which itself wraps its command in this same slot. Without a
// guard the inner acquire would block forever waiting on the slot its own
// ancestor already holds. The runner stamps the child's env with the holder
// PID; any invocation that finds the stamp set skips the acquire and inherits
// the ancestor's slot for free.
//
// As a CLI: `node scripts/gate-slot.mjs <command> [args...]` acquires the
// slot, runs the command, and releases on exit. This is what `pnpm gate`
// wraps around `sh -c "pnpm format && pnpm check && pnpm test"`, so a human
// `pnpm gate` and a runner gate can never collide.

import { spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SLOT_DIR = path.join(os.tmpdir(), 'abl-gate-slot.lock');
// Env stamp carrying the holder PID so a nested gate invocation inherits the
// ancestor's slot instead of deadlocking on a second acquire.
export const SLOT_ENV = 'ABL_GATE_SLOT';

const POLL_MS = 2000;
// A claim dir without a readable PID is normally a holder caught between the
// mkdir and the PID write; only treat it as abandoned after this long.
const NO_PID_GRACE_MS = 10_000;

const pidPath = (dir) => path.join(dir, 'pid');

function tryClaim(dir) {
  try {
    mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  writeFileSync(pidPath(dir), String(process.pid));
  return true;
}

/** PID of the current holder, or NaN when the file is missing/unreadable. */
function holderPid(dir) {
  try {
    return Number.parseInt(readFileSync(pidPath(dir), 'utf8'), 10);
  } catch {
    return NaN;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function holderIsDead(dir, pid) {
  if (Number.isInteger(pid) && pid > 0) return !isAlive(pid);
  try {
    return Date.now() - statSync(dir).mtimeMs > NO_PID_GRACE_MS;
  } catch {
    return false; // Claim vanished — not ours to steal; just retry mkdir.
  }
}

function steal(dir) {
  const trash = `${dir}.stale.${process.pid}`;
  try {
    renameSync(dir, trash);
    rmSync(trash, { recursive: true, force: true });
  } catch {
    // Another contender stole it first; the retry loop will re-check.
  }
}

/**
 * Block until this process holds the slot. Polls-and-races the atomic mkdir,
 * stealing a dead holder's claim on the way. `onWait(pid)` fires once per
 * newly observed live holder so callers can log the wait without spamming
 * every poll.
 */
export async function acquire({ dir = DEFAULT_SLOT_DIR, onWait } = {}) {
  let waitingOn;
  for (;;) {
    if (tryClaim(dir)) return;
    const pid = holderPid(dir);
    if (holderIsDead(dir, pid)) {
      steal(dir);
      continue;
    }
    if (waitingOn !== pid) {
      onWait?.(pid);
      waitingOn = pid;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Release the slot, but only if this process actually holds it — the PID check
 * makes a stray call a no-op instead of yanking another holder's claim (e.g.
 * on the env-passthrough path, where the slot is owned by an ancestor).
 */
export function release({ dir = DEFAULT_SLOT_DIR } = {}) {
  if (holderPid(dir) === process.pid) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error('usage: gate-slot.mjs <command> [args...]');
    process.exit(2);
  }

  const spawnCommand = () => {
    const child = spawn(command, args, { stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      // Forward the signal and let the child wind down; its 'exit' handler
      // releases the slot and ends this process.
      process.once(signal, () => child.kill(signal));
    }
    child.on('exit', (code, signal) => {
      release();
      process.exit(signal !== null ? 1 : (code ?? 1));
    });
    child.on('error', (error) => {
      console.error(`gate-slot: failed to run ${command}: ${error.message}`);
      release();
      process.exit(1);
    });
  };

  if (process.env[SLOT_ENV]) {
    // An ancestor already holds the slot; run directly without acquiring.
    spawnCommand();
    return;
  }
  // 'exit' fires on normal completion and uncaught errors; the child's signal
  // forwarding turns fatal signals into a normal exit so this runs then too.
  process.on('exit', () => release());
  acquire({ onWait: (pid) => console.error(`waiting for gate slot held by pid ${pid}`) }).then(
    () => {
      process.env[SLOT_ENV] = String(process.pid);
      spawnCommand();
    },
  );
}

// Only run the CLI when invoked directly (`node scripts/gate-slot.mjs …`), not
// when imported by the runner or the tests. realpath both sides so a symlinked
// invocation still matches.
const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runCli(process.argv.slice(2));
}
