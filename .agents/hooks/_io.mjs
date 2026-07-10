// Shared hook I/O helpers — normalizes Claude / Codex / Cursor envelope
// differences so the canonical hooks contain one copy of the business logic
// instead of branching per harness.
//
// Each hook in this directory exposes:
//   1. A default-exported pure async function `(input) => Result` so
//      Trinity-as-harness can `import` and call directly (no subprocess).
//   2. A CLI shim guarded by `isCLI(import.meta.url)` that reads stdin,
//      invokes the function, and emits a harness-correct response. External
//      harnesses (Claude Code, Codex CLI, Cursor) subprocess this path.
//
// Result variants returned by the pure functions:
//   { approve: true }                — universal no-op (emits {} on every harness/event)
//   { deny: true, reason: string }   — PreToolUse deny (gates the tool call before it runs)
//   { block: true, reason: string }  — PostToolUse block (after the tool ran)
//   { stopBlock: true, reason }      — Stop-event block
//
// Note: approve emits `{}` universally because Codex rejects
// `{"decision":"approve"}` on every event with errors like
// "PreToolUse hook returned unsupported decision:approve" and
// "hook returned invalid post-tool-use JSON output". `{}` is the
// documented no-op for Claude on all events, so one shape works everywhere.
//
// Why:
//   - Claude and Codex use a field-for-field identical hook envelope
//     (session_id, tool_input.{command,file_path}, tool_response.*) and the
//     same output schema ({decision, reason}). One code path works for both.
//   - Cursor uses a different envelope (conversation_id, top-level .command
//     on afterShellExecution, .tool_output as a JSON-encoded string) and a
//     different output schema (post-events accept *no* output fields per
//     cursor.com/docs/hooks — observation-only; Stop uses followup_message).

import { stdin } from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function readInput() {
  let buf = "";
  for await (const chunk of stdin) buf += chunk;
  return JSON.parse(buf);
}

export function detectHarness(input) {
  return "conversation_id" in input ? "cursor" : "claude_codex";
}

export function getSessionId(input) {
  return input.session_id ?? input.conversation_id ?? "";
}

export function getCommand(input) {
  // Claude/Codex put it at .tool_input.command (PostToolUse Bash).
  // Cursor's afterShellExecution puts it at top-level .command; generic
  // postToolUse mirrors Claude's path.
  return input.tool_input?.command ?? input.command ?? "";
}

export function getFilePath(input) {
  // Claude: .tool_input.file_path. Older payloads: .tool_input.filePath.
  // Cursor afterFileEdit: top-level .file_path.
  return (
    input.tool_input?.file_path ??
    input.tool_input?.filePath ??
    input.file_path ??
    ""
  );
}

export function isError(input) {
  // Cursor's afterShellExecution fires for both success and failure;
  // exit code lives inside .tool_output, which is a JSON-encoded *string*.
  // Claude/Codex: PostToolUse only fires on success (failures are a
  // separate PostToolUseFailure event we don't subscribe to), and the
  // tool_response shape for Bash isn't uniformly documented — many real
  // Claude payloads omit isError entirely, so default false (success).
  if (detectHarness(input) === "cursor") {
    const out = input.tool_output;
    if (out == null) return false;
    try {
      const parsed = typeof out === "string" ? JSON.parse(out) : out;
      return (parsed?.exitCode ?? 0) !== 0;
    } catch {
      return false;
    }
  }
  return input.tool_response?.isError === true;
}

/**
 * Emit a hook decision to stdout for the given harness.
 *
 * @param {"claude_codex"|"cursor"} harness
 * @param {{approve?:true} | {deny:true, reason:string} | {block:true, reason:string} | {stopBlock:true, reason:string}} result
 */
export function emit(harness, result) {
  if (result.approve) {
    process.stdout.write("{}\n");
    return;
  }
  if (result.deny) {
    // PreToolUse deny — different shape per harness.
    // Claude/Codex: modern hookSpecificOutput.permissionDecision schema.
    // Cursor: beforeShellExecution / preToolUse take {permission, user_message}.
    if (harness === "cursor") {
      process.stdout.write(
        JSON.stringify({ permission: "deny", user_message: result.reason }) + "\n",
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.reason,
          },
        }) + "\n",
      );
    }
    return;
  }
  if (result.block) {
    if (harness === "cursor") {
      // Cursor post-events can't block (no output fields documented). Surface
      // the would-be reason to stderr so the no-op isn't silent.
      process.stderr.write(
        `[hook] PostToolUse block not enforceable on Cursor; reason: ${result.reason}\n`,
      );
      process.stdout.write("{}\n");
    } else {
      process.stdout.write(
        JSON.stringify({ decision: "block", reason: result.reason }) + "\n",
      );
    }
    return;
  }
  if (result.stopBlock) {
    if (harness === "cursor") {
      process.stdout.write(
        JSON.stringify({ followup_message: result.reason }) + "\n",
      );
    } else {
      process.stdout.write(
        JSON.stringify({ decision: "block", reason: result.reason }) + "\n",
      );
    }
    return;
  }
  throw new Error(`hook returned unknown decision: ${JSON.stringify(result)}`);
}

/**
 * True when this file is being executed directly (CLI mode), false when
 * imported as a module. Use to guard the CLI shim in each hook file.
 *
 *   if (isCLI(import.meta.url)) { ... }
 */
export function isCLI(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
