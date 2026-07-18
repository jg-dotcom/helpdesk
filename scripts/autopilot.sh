#!/bin/bash
# Unattended Todo -> implemented -> pushed -> Done pipeline for Helpdesk.
# Meant to be run via cron or launchd on YOUR machine (has real git push
# credentials) — never run this from a sandboxed/no-network environment.
#
# BEFORE FIRST USE:
#   1. chmod +x scripts/autopilot.sh
#   2. Run `claude mcp list` in this repo and confirm the Linear MCP server
#      is registered. If its tool names differ from the placeholder below
#      (mcp__linear__*), edit ALLOWED_TOOLS to match what `claude mcp list`
#      / a normal session shows you.
#   3. Do a dry run manually first: `bash scripts/autopilot.sh` and watch
#      scripts/autopilot.log — don't trust a scheduled job you haven't
#      watched succeed at least once.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

LOCKFILE="/tmp/helpdesk-autopilot.lock"
LOG="$(pwd)/scripts/autopilot.log"

if [ -e "$LOCKFILE" ]; then
  echo "$(date): already running (lockfile present), exiting." >> "$LOG"
  exit 0
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

echo "=== Run started $(date) ===" >> "$LOG"

# Restrict exactly what this unattended run is allowed to touch. This is
# deliberately narrower than --dangerously-skip-permissions: git push and
# tests are allowed, but nothing outside this explicit list runs without a
# human. Server name confirmed via `claude mcp list` as "claude_ai_Linear".
# Each entry MUST stay a single array element — "Bash(git add*)" contains a
# space, and passing this as a plain string lets bash word-split it into
# garbage tokens (confirmed bug from the first test run: rules like "log*"
# and "push*" got silently ignored because of exactly this).
ALLOWED_TOOLS=(
  "Read" "Write" "Edit" "Grep" "Glob"
  "Bash(npm test*)" "Bash(npx tsc*)"
  "Bash(git add*)" "Bash(git commit*)" "Bash(git push*)" "Bash(git status*)"
  "Bash(git log*)" "Bash(git fetch*)" "Bash(git checkout*)" "Bash(git diff*)"
  "Bash(curl*)" "Bash(echo*)"
  "mcp__claude_ai_Linear__list_issues" "mcp__claude_ai_Linear__get_issue"
  "mcp__claude_ai_Linear__save_issue" "mcp__claude_ai_Linear__save_comment"
)

# Optional Vercel deployment-verification config (Step 6 Check D). Sourced
# from a gitignored local file (never committed, never seen by anyone but
# you) so the token isn't hardcoded in this script. If the file doesn't
# exist, Check D is simply skipped by the prompt and the routine falls back
# to its original 3-check verification — nothing breaks either way.
if [ -f "$(pwd)/scripts/.env.autopilot" ]; then
  # shellcheck disable=SC1091
  source "$(pwd)/scripts/.env.autopilot"
  export VERCEL_TOKEN VERCEL_PROJECT_ID
fi

# Safety cap — process at most this many issues in one invocation, even if
# more are sitting in Todo. Each issue still gets its own isolated
# implement -> test -> push -> verify cycle (separate claude -p call), but
# an unattended run can't silently push an unbounded pile of commits just
# because a big batch got approved to Todo at once. Raise this once you've
# watched a handful of runs succeed cleanly.
MAX_ISSUES_PER_RUN=5

# Timeout for a single issue attempt. Confirmed real bug from a run on
# 2026-07-17: a claude -p call sat at 0% CPU, "sleeping", for 10+ minutes
# with no progress and no error — a true hang, not just slow work. Without
# a timeout, a hung run blocks every future scheduled run forever (via the
# lockfile) with nobody watching to notice or Ctrl+C it manually.
TIMEOUT_SECS=600

# Tracks issue IDs already attempted (and failed) THIS script run, so a
# ticket that gets left in Todo after a failed attempt doesn't just get
# picked again on the next loop iteration — confirmed real bug from the
# same run: "Issue attempt 2/3" almost certainly re-picked JAY-79 right
# after attempt 1 had already discarded and failed on it.
ALREADY_ATTEMPTED=()

for i in $(seq 1 "$MAX_ISSUES_PER_RUN"); do
  echo "--- Issue attempt $i/$MAX_ISSUES_PER_RUN ($(date)) ---" >> "$LOG"

  PROMPT_TEXT="$(cat scripts/autopilot-prompt.md)"
  if [ "${#ALREADY_ATTEMPTED[@]}" -gt 0 ]; then
    PROMPT_TEXT="$PROMPT_TEXT

ADDITIONAL CONSTRAINT FOR THIS RUN: do not pick any of these issue IDs, even
if they are still in Todo — they were already attempted and failed earlier
in this same run: ${ALREADY_ATTEMPTED[*]}. If every remaining Todo issue is
in this list, treat it the same as an empty Todo list and stop."
  fi

  # set -e will kill the whole script the instant `claude` exits non-zero,
  # BEFORE the output ever gets written to the log — confirmed bug from a
  # real run. Disable errexit around just this call so a bad exit code gets
  # logged instead of eaten silently.
  set +e

  TMPOUT="$(mktemp)"
  claude -p "$PROMPT_TEXT" \
    --allowedTools "${ALLOWED_TOOLS[@]}" \
    --permission-mode acceptEdits \
    --output-format text > "$TMPOUT" 2>&1 &
  CLAUDE_PID=$!

  ELAPSED=0
  TIMED_OUT=0
  while kill -0 "$CLAUDE_PID" 2>/dev/null; do
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    if [ "$ELAPSED" -ge "$TIMEOUT_SECS" ]; then
      kill -9 "$CLAUDE_PID" 2>/dev/null
      TIMED_OUT=1
      break
    fi
  done
  wait "$CLAUDE_PID" 2>/dev/null
  CLAUDE_EXIT=$?
  OUTPUT="$(cat "$TMPOUT")"
  rm -f "$TMPOUT"

  set -e

  echo "$OUTPUT" >> "$LOG"

  if [ "$TIMED_OUT" -eq 1 ]; then
    echo "(TIMED OUT after ${TIMEOUT_SECS}s — killed. Any uncommitted changes were left as-is; run 'git status'/'git checkout -- .' manually before trusting the next run.)" >> "$LOG"
    echo "Stopping this run after a timeout rather than continuing to the next issue attempt." >> "$LOG"
    break
  fi

  echo "(claude exited with status $CLAUDE_EXIT)" >> "$LOG"

  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Non-zero exit — stopping this run rather than continuing to the next issue attempt." >> "$LOG"
    break
  fi

  if echo "$OUTPUT" | grep -qi "No Todo issues, nothing to do"; then
    echo "Todo is empty — stopping after $((i - 1)) issue(s) processed." >> "$LOG"
    break
  fi

  if echo "$OUTPUT" | grep -qi "Only data-schema issues in Todo"; then
    echo "Remaining Todo issues are all data-schema — stopping after $((i - 1)) issue(s) processed." >> "$LOG"
    break
  fi

  # Pull out whichever issue ID this attempt actually picked (if any) so a
  # failed one doesn't get retried on the next loop iteration.
  PICKED_ID="$(echo "$OUTPUT" | grep -oE 'JAY-[0-9]+' | head -1 || true)"
  if [ -n "$PICKED_ID" ] && ! echo "$OUTPUT" | grep -qi "moved to \"Done\"\|status.*Done"; then
    ALREADY_ATTEMPTED+=("$PICKED_ID")
  fi
done

echo "=== Run finished $(date) ===" >> "$LOG"
