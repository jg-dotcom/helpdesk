#!/bin/bash
# Continuous 4-stage Todo -> Done pipeline for Helpdesk: Tech Lead -> Engineer
# -> QA -> Deploy & Finalize. Meant to be run via launchd on YOUR machine (has
# real git push credentials) — never run this from a sandboxed/no-network
# environment.
#
# WHY 4 STAGES: earlier versions did everything in one undifferentiated
# claude -p call (plan + implement + test + verify + deploy all mixed
# together, trusting its own self-report at every step). Converted to a real
# multi-stage pipeline on 2026-07-18 once usage headroom (Max plan) made the
# extra claude -p invocations per ticket affordable: Tech Lead reads the
# ticket and produces a plan (read-only, can call NO-GO); Engineer implements
# against that plan (write access, no git); QA independently re-verifies
# everything from scratch — re-runs tests itself, reviews the actual diff —
# rather than trusting Engineer's own report (read-only + test-running, no
# write); Deploy & Finalize is the only stage with git-write and Linear-write
# access, and handles all three possible outcomes (NO-GO, QA FAIL, QA PASS).
# Each stage gets a narrower ALLOWED_TOOLS list than the old single-call
# design, so a compromised or confused stage has less blast radius.
#
# This is a persistent daemon, not a one-shot script: it loops forever,
# processing one Todo issue per iteration (all 4 stages) with a short
# cooldown between issues and a longer idle poll when Todo is empty/all
# data-schema. launchd should start this ONCE (RunAtLoad + KeepAlive, no
# StartInterval) rather than re-invoking it on a timer.
#
# IMPORTANT LESSON BAKED IN BELOW: a failed ticket's discard step
# (`git checkout -- .`) and the deploy step's commit (`git add -A`) both
# operate on the whole working tree by default — which previously wiped out
# uncommitted edits to THESE VERY SCRIPTS sitting in the same repo,
# confirmed as a real incident on 2026-07-18 (this script silently reverted
# to an old committed version after a failed-ticket discard ran mid-session).
# Every discard/add command in the per-stage prompt files below is scoped
# with a pathspec exclusion (':!scripts/autopilot*') to prevent this
# recurring. If you ever hand-edit these scripts again, commit immediately —
# scoping reduces the blast radius but committing is the real fix.
#
# BEFORE FIRST USE:
#   1. chmod +x scripts/autopilot.sh
#   2. Run `claude mcp list` in this repo and confirm the Linear MCP server
#      is registered. Server name confirmed as "claude_ai_Linear".
#   3. Do a dry run manually first: `bash scripts/autopilot.sh` and watch
#      scripts/autopilot.log — don't trust a scheduled job you haven't
#      watched succeed at least once. Ctrl+C to stop a manual foreground run.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# launchd runs jobs with a minimal PATH (it never sources .zshrc/.bash_profile
# the way an interactive Terminal shell does). Absolute path confirmed via
# `which claude` — update this if you ever reinstall/relocate the CLI.
CLAUDE_BIN="/Users/hansomeGuy/.local/bin/claude"
export PATH="$(dirname "$CLAUDE_BIN"):/usr/local/bin:/opt/homebrew/bin:$PATH"

LOCKFILE="/tmp/helpdesk-autopilot.lock"
LOG="$(pwd)/scripts/autopilot.log"

if [ -e "$LOCKFILE" ]; then
  echo "$(date): already running (lockfile present), exiting." >> "$LOG"
  exit 0
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

echo "=== Daemon started (4-stage pipeline) $(date) ===" >> "$LOG"

# Per-stage tool scoping — deliberately narrower than one shared list.
# Each entry MUST stay a single array element (space-containing entries like
# "Bash(git add*)" get word-split into garbage if passed as a plain string).
TOOLS_TECHLEAD=(
  "Read" "Grep" "Glob"
  "Bash(git log*)" "Bash(git diff*)"
  "mcp__claude_ai_Linear__list_issues" "mcp__claude_ai_Linear__get_issue"
)
TOOLS_ENGINEER=(
  "Read" "Write" "Edit" "Grep" "Glob"
  "Bash(npm test*)" "Bash(npx tsc*)"
)
TOOLS_QA=(
  "Read" "Grep" "Glob"
  "Bash(npm test*)" "Bash(npx tsc*)"
  "Bash(git diff*)" "Bash(git status*)" "Bash(git checkout*)"
)
TOOLS_DEPLOY=(
  "Bash(git add*)" "Bash(git commit*)" "Bash(git push*)"
  "Bash(git status*)" "Bash(git log*)" "Bash(git fetch*)" "Bash(curl*)" "Bash(echo*)"
  "mcp__claude_ai_Linear__save_issue" "mcp__claude_ai_Linear__save_comment"
)
TOOLS_IDEAGEN=(
  "Read" "Grep" "Glob" "Bash(git log*)"
  "mcp__claude_ai_Linear__list_issues" "mcp__claude_ai_Linear__get_issue" "mcp__claude_ai_Linear__save_issue"
)

# Optional Vercel deployment-verification config (Deploy stage Check D).
# Sourced from a gitignored local file so the token isn't hardcoded here.
if [ -f "$(pwd)/scripts/.env.autopilot" ]; then
  # shellcheck disable=SC1091
  source "$(pwd)/scripts/.env.autopilot"
  export VERCEL_TOKEN VERCEL_PROJECT_ID
fi

TIMEOUT_SECS=600      # per-stage hang protection
COOLDOWN_SECS=20      # pause between successive issues
IDLE_SLEEP_SECS=120   # pause when Todo is empty/all-data-schema
IDEAGEN_COOLDOWN_SECS=3600  # at most once per hour, even if idle the whole time
LAST_IDEAGEN_TS=0
ALREADY_ATTEMPTED=()
ITER=0

# Called from the idle branches below. Runs the emergency top-up stage at
# most once per IDEAGEN_COOLDOWN_SECS, so a long idle stretch doesn't
# trigger it on every single idle poll. The prompt itself checks Backlog
# count and self-aborts if there's already enough waiting for review —
# emptying Todo isn't the same as running out of ideas, it usually just
# means the user hasn't approved anything from Backlog yet.
maybe_run_ideagen() {
  local now
  now="$(date +%s)"
  if [ "$((now - LAST_IDEAGEN_TS))" -lt "$IDEAGEN_COOLDOWN_SECS" ]; then
    return
  fi
  LAST_IDEAGEN_TS="$now"
  local prompt
  prompt="$(cat scripts/autopilot-prompt-5-ideagen.md)"
  run_stage "IDEAGEN" "$prompt" TOOLS_IDEAGEN
}

# Runs one claude -p call with the given prompt text and allowed-tools array
# (passed by name, resolved via eval — bash 3.2 compatible, see below), with
# the same timeout/errexit-safety wrapper every stage needs. Sets globals:
# OUTPUT, CLAUDE_EXIT, TIMED_OUT.
run_stage() {
  local stage_name="$1"
  local prompt_text="$2"
  local arr_name="$3"
  # macOS ships /bin/bash frozen at 3.2 (GPLv2 licensing) — no `local -n`
  # nameref support (that's bash 4.3+). Use eval-based indirect array
  # expansion instead, which works on 3.2. Confirmed as the real cause of
  # every stage failing immediately with "local: -n: invalid option" during
  # the 2026-07-18 4-stage rollout (see autopilot-launchd-error.log).
  eval "local tools_ref=(\"\${${arr_name}[@]}\")"

  echo "  [${stage_name}] starting ($(date))" >> "$LOG"

  set +e
  local tmpout
  tmpout="$(mktemp)"
  "$CLAUDE_BIN" -p "$prompt_text" \
    --allowedTools "${tools_ref[@]}" \
    --permission-mode acceptEdits \
    --output-format text > "$tmpout" 2>&1 &
  local pid=$!

  local elapsed=0
  TIMED_OUT=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$TIMEOUT_SECS" ]; then
      kill -9 "$pid" 2>/dev/null
      TIMED_OUT=1
      break
    fi
  done
  wait "$pid" 2>/dev/null
  CLAUDE_EXIT=$?
  OUTPUT="$(cat "$tmpout")"
  rm -f "$tmpout"
  set -e

  echo "$OUTPUT" >> "$LOG"
  echo "  [${stage_name}] exit=$CLAUDE_EXIT timed_out=$TIMED_OUT" >> "$LOG"
}

while true; do
  ITER=$((ITER + 1))
  echo "--- Issue cycle #$ITER ($(date)) ---" >> "$LOG"

  EXCLUSION_TEXT=""
  if [ "${#ALREADY_ATTEMPTED[@]}" -gt 0 ]; then
    EXCLUSION_TEXT="

ADDITIONAL CONSTRAINT: do not pick any of these issue IDs, even if they are
still in Todo — they were already attempted and failed earlier this cycle:
${ALREADY_ATTEMPTED[*]}. If every remaining Todo issue is in this list,
treat it the same as an empty Todo list and stop."
  fi

  # --- STAGE 1: TECH LEAD ---
  TECHLEAD_PROMPT="$(cat scripts/autopilot-prompt-1-techlead.md)${EXCLUSION_TEXT}"
  run_stage "TECH LEAD" "$TECHLEAD_PROMPT" TOOLS_TECHLEAD

  if [ "$TIMED_OUT" -eq 1 ] || [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Tech Lead stage failed/timed out — sleeping ${IDLE_SLEEP_SECS}s." >> "$LOG"
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi

  if echo "$OUTPUT" | grep -qi "No Todo issues, nothing to do"; then
    echo "Todo is empty — clearing attempted-list, checking whether a Backlog top-up is needed." >> "$LOG"
    ALREADY_ATTEMPTED=()
    maybe_run_ideagen
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi

  if echo "$OUTPUT" | grep -qi "Only data-schema issues in Todo"; then
    echo "Remaining Todo issues are all data-schema — clearing attempted-list, checking whether a Backlog top-up is needed." >> "$LOG"
    ALREADY_ATTEMPTED=()
    maybe_run_ideagen
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi

  TECHLEAD_OUTPUT="$OUTPUT"
  PICKED_ID="$(echo "$TECHLEAD_OUTPUT" | grep -oE 'JAY-[0-9]+' | head -1 || true)"

  # --- STAGE 2: ENGINEER ---
  ENGINEER_PROMPT="$(cat scripts/autopilot-prompt-2-engineer.md)

TECH LEAD'S PLAN (from the previous stage):
${TECHLEAD_OUTPUT}"
  run_stage "ENGINEER" "$ENGINEER_PROMPT" TOOLS_ENGINEER

  if [ "$TIMED_OUT" -eq 1 ] || [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Engineer stage failed/timed out on ${PICKED_ID:-unknown} — leaving any partial changes as-is, sleeping ${IDLE_SLEEP_SECS}s." >> "$LOG"
    [ -n "$PICKED_ID" ] && ALREADY_ATTEMPTED+=("$PICKED_ID")
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi
  ENGINEER_OUTPUT="$OUTPUT"

  # --- STAGE 3: QA ---
  QA_PROMPT="$(cat scripts/autopilot-prompt-3-qa.md)

TECH LEAD'S PLAN:
${TECHLEAD_OUTPUT}

ENGINEER'S REPORT:
${ENGINEER_OUTPUT}"
  run_stage "QA" "$QA_PROMPT" TOOLS_QA

  if [ "$TIMED_OUT" -eq 1 ] || [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "QA stage failed/timed out on ${PICKED_ID:-unknown} — sleeping ${IDLE_SLEEP_SECS}s." >> "$LOG"
    [ -n "$PICKED_ID" ] && ALREADY_ATTEMPTED+=("$PICKED_ID")
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi
  QA_OUTPUT="$OUTPUT"

  # --- STAGE 4: DEPLOY & FINALIZE ---
  DEPLOY_PROMPT="$(cat scripts/autopilot-prompt-4-deploy.md)

TECH LEAD'S PLAN:
${TECHLEAD_OUTPUT}

ENGINEER'S REPORT:
${ENGINEER_OUTPUT}

QA'S VERDICT:
${QA_OUTPUT}"
  run_stage "DEPLOY" "$DEPLOY_PROMPT" TOOLS_DEPLOY

  if [ "$TIMED_OUT" -eq 1 ] || [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Deploy stage failed/timed out on ${PICKED_ID:-unknown} — this may leave the ticket in an inconsistent state (implemented but not committed/closed). Check manually. Sleeping ${IDLE_SLEEP_SECS}s." >> "$LOG"
    [ -n "$PICKED_ID" ] && ALREADY_ATTEMPTED+=("$PICKED_ID")
    sleep "$IDLE_SLEEP_SECS"
    continue
  fi

  if [ -n "$PICKED_ID" ] && ! echo "$OUTPUT" | grep -qi "moved to \"Done\"\|status.*Done"; then
    ALREADY_ATTEMPTED+=("$PICKED_ID")
  fi

  echo "Cooling down ${COOLDOWN_SECS}s before the next issue." >> "$LOG"
  sleep "$COOLDOWN_SECS"
done
