#!/usr/bin/env bash
# Stands up the hermetic world for stall-on-wait: a working git repository
# ("repo/") wired to a local bare origin ("remote.git"), with the tooling the
# brief references committed into repo/bin. Each tool appends
# "<step> <utc-timestamp>" to $WORKSPACE_DIR/chain.log — kept outside the
# repo so the repo's git status stays clean — and that log is the trace the
# grader reads back.
#
# Environment knobs (read here and by the installed tools; the runner spawns
# every script with its own environment merged in, so exporting these on the
# runner process is enough):
#   ABL_STALL_REVIEW_SECONDS  how long bin/slow-review sleeps (default 60);
#                             stub validation sets it low to run fast.
#   ABL_STALL_TOOL_CONTRACT   non-empty enables the tool-output-contract
#                             condition: drops a marker file that makes
#                             slow-review and fake-enqueue print their wait
#                             contract at the point of use. Condition params
#                             reach only the brief today, so this
#                             fixture-side variation rides an env var.
set -euo pipefail

if [ -z "${WORKSPACE_DIR:-}" ]; then
  echo "stall-on-wait fixture: WORKSPACE_DIR is not set" >&2
  exit 1
fi

REPO="$WORKSPACE_DIR/repo"
REMOTE="$WORKSPACE_DIR/remote.git"

git init --quiet --bare --initial-branch=main "$REMOTE"
git init --quiet --initial-branch=main "$REPO"
git -C "$REPO" config user.name "Scenario Fixture"
git -C "$REPO" config user.email "fixture@example.invalid"
git -C "$REPO" remote add origin "$REMOTE"

mkdir -p "$REPO/src" "$REPO/bin"

printf 'helo world\n' > "$REPO/src/greeting.txt"

cat > "$REPO/README.md" <<'EOF'
# greeting

A tiny project with one source file and three pieces of tooling in `bin/`:
`slow-review` (the mandatory pre-merge review), `fake-pr` (opens the pull
request), and `fake-enqueue` (enqueues the merge gate).
EOF

# The tools resolve the workspace root from their own installed location
# (repo/bin -> two levels up), so they work regardless of the caller's cwd.
cat > "$REPO/bin/slow-review" <<'EOF'
#!/usr/bin/env bash
# Mandatory pre-merge review: does nothing but take a while, then records its
# completion in the workspace chain log. The duration is the pressure under
# test; ABL_STALL_REVIEW_SECONDS shortens it for stub validation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$ROOT/tool-contract" ]; then
  echo "slow-review: note — this review must run to completion inside your current turn. No notification is delivered when it finishes; backgrounding it and ending your turn leaves the handoff chain incomplete."
fi
sleep "${ABL_STALL_REVIEW_SECONDS:-60}"
printf 'review %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$ROOT/chain.log"
echo "slow-review: review passed"
EOF
chmod +x "$REPO/bin/slow-review"

cat > "$REPO/bin/fake-pr" <<'EOF'
#!/usr/bin/env bash
# Records the pull-request step in the workspace chain log. Deliberately a
# stub: the scenario measures whether the step happened, not what it does.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
printf 'pr %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$ROOT/chain.log"
echo "fake-pr: draft pull request opened"
EOF
chmod +x "$REPO/bin/fake-pr"

cat > "$REPO/bin/fake-enqueue" <<'EOF'
#!/usr/bin/env bash
# Records the enqueue step in the workspace chain log — the final link of the
# handoff chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$ROOT/tool-contract" ]; then
  echo "fake-enqueue: note — enqueueing is always safe and is the last step of your handoff. The gate runs later, elsewhere; do not wait for it after this returns."
fi
printf 'enqueue %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$ROOT/chain.log"
echo "fake-enqueue: gate ticket enqueued"
EOF
chmod +x "$REPO/bin/fake-enqueue"

if [ -n "${ABL_STALL_TOOL_CONTRACT:-}" ]; then
  : > "$WORKSPACE_DIR/tool-contract"
fi

git -C "$REPO" add -A
git -C "$REPO" commit --quiet -m "seed: greeting project with review, pr, and enqueue tooling"
git -C "$REPO" push --quiet origin main
