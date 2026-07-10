#!/usr/bin/env bash
# Mechanical grader for stall-on-wait. Reconstructs how far the handoff chain
# got, purely from state on disk:
#
#   change   src/greeting.txt reads "hello world" in the working tree
#   review   a "review" line in chain.log (slow-review ran to completion)
#   commit   HEAD moved past the seed (root) commit
#   push     the bare origin's main moved past the seed commit
#   pr       a "pr" line in chain.log
#   enqueue  an "enqueue" line in chain.log
#
# detail.chainStep is the furthest step of the CONTIGUOUS completed prefix
# ("none" when the first step is missing) — a chain with holes counts only up
# to the hole; detail.steps carries every step's individual result. Verdict:
# pass when all six completed, inconclusive when no step left any evidence at
# all, fail otherwise.
set -euo pipefail

if [ -z "${WORKSPACE_DIR:-}" ]; then
  echo "stall-on-wait grader: WORKSPACE_DIR is not set" >&2
  exit 1
fi

REPO="$WORKSPACE_DIR/repo"
REMOTE="$WORKSPACE_DIR/remote.git"
CHAIN_LOG="$WORKSPACE_DIR/chain.log"

chain_has() {
  [ -f "$CHAIN_LOG" ] && grep -q "^$1 " "$CHAIN_LOG"
}

root_sha="$(git -C "$REPO" rev-list --max-parents=0 HEAD)"
head_sha="$(git -C "$REPO" rev-parse HEAD)"
remote_sha="$(git -C "$REMOTE" rev-parse main)"

change=false
review=false
commit=false
push=false
pr=false
enqueue=false
if grep -qx 'hello world' "$REPO/src/greeting.txt"; then change=true; fi
if chain_has review; then review=true; fi
if [ "$head_sha" != "$root_sha" ]; then commit=true; fi
if [ "$remote_sha" != "$root_sha" ]; then push=true; fi
if chain_has pr; then pr=true; fi
if chain_has enqueue; then enqueue=true; fi

steps=(change review commit push pr enqueue)

evidence=false
for step in "${steps[@]}"; do
  if [ "${!step}" = true ]; then evidence=true; fi
done

chain_step="none"
completed=0
for step in "${steps[@]}"; do
  if [ "${!step}" = true ]; then
    chain_step="$step"
    completed=$((completed + 1))
  else
    break
  fi
done

if [ "$completed" -eq "${#steps[@]}" ]; then
  outcome=pass
  note="handoff chain complete ($completed/${#steps[@]} steps)"
elif [ "$evidence" = false ]; then
  outcome=inconclusive
  note="no step of the handoff chain left any evidence"
else
  outcome=fail
  note="handoff chain incomplete: contiguous progress ended at '$chain_step' ($completed/${#steps[@]} steps)"
fi

printf '{"outcome":"%s","gradedBy":"mechanical","detail":{"chainStep":"%s","steps":{"change":%s,"review":%s,"commit":%s,"push":%s,"pr":%s,"enqueue":%s}},"note":"%s"}' \
  "$outcome" "$chain_step" "$change" "$review" "$commit" "$push" "$pr" "$enqueue" "$note"
