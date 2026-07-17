You are running unattended via cron/launchd. No human is present to answer
questions or approve anything mid-run. Follow this exactly — do not improvise
scope beyond it, and when genuinely uncertain whether something is safe, stop
and leave a comment instead of guessing.

Repo: this directory, a Next.js + Supabase HR app ("Helpdesk"). Linear team
is "Jay". Match existing code conventions — read AGENTS.md/CLAUDE.md in this
repo first if you haven't internalized them yet this session.

STEP 1 — Find work.
Call list_issues on team "Jay", state "Todo", orderBy createdAt, limit 25.
If there are none, output "No Todo issues, nothing to do." and stop.

STEP 2 — Pick ONE issue.
Pick the OLDEST Todo issue that does NOT have the label "tier:data-schema".
Never touch a tier:data-schema issue in this routine — those always need a
human to implement by hand, no exceptions. If every Todo issue is
tier:data-schema, output "Only data-schema issues in Todo — needs manual
implementation, skipping this run." and stop.

STEP 3 — Implement.
Call get_issue to read the full description, grounding, and mockup (if any).
Implement exactly what it describes. No unrelated refactors, no scope creep,
no "while I'm in here" changes to other files.

Make all changes directly with the Edit/Write tools on the actual source
files. Do NOT write a helper script (Python, Node, shell, etc.) and then
try to execute it — that requires a Bash tool call outside this routine's
allowed-tools list, which isn't cleanly denied in headless mode, it just
hangs waiting for an approval that can never come. Confirmed real bug from
a run on 2026-07-17 that hung for 10+ minutes this exact way. If a change
is large (e.g. a full-page recolor), still do it via direct Edit calls,
even if that means several edits in a row — never generate-then-run a
script as a shortcut.

STEP 4 — Verify before touching git.
Run `npm test`. If it fails, that's always real (there is no such thing as a
"pre-existing" failing test in a suite that was passing before you touched
anything) — discard and stop per the failure procedure below.

For `npx tsc --noEmit`, this codebase has known, pre-existing type errors
unrelated to any of these tickets (missing `pdfkit`/`@anthropic-ai/sdk`
packages, a Stripe typings mismatch, a couple of other stray ones) — this
was confirmed by a real run on 2026-07-17. A clean `tsc` run is NOT the bar,
because it can never pass and every future ticket would falsely fail
forever. Instead: run `npx tsc --noEmit` BEFORE making any changes (on the
clean checkout) and save that error list as the baseline. After
implementing, run it again. Compare the two lists. Only treat this as a
failure if the AFTER list contains errors that are NOT in the BEFORE list
(new errors your change introduced) — pre-existing errors present in both
lists are not your problem and do not block this ticket.

Failure procedure (npm test failed, OR tsc shows genuinely new errors):
  - Run `git checkout -- .` to discard all changes.
  - Call save_comment on the issue explaining what failed (the actual error
    output, not a vague summary) and that the change was discarded.
  - Leave the issue in "Todo".
  - Stop. Do not attempt a fix-up or retry in the same run.

STEP 5 — Commit and push.
If both checks passed:
  `git add -A`
  `git commit -m "<ISSUE-ID>: <short title>"`
  `git push`

STEP 6 — Confidence-scored verification (do NOT rely on a single check).
Tonight's actual incidents happened because one signal (git said "pushed")
was trusted completely, and that signal alone missed a real problem (a
GitHub outage silently broke the deploy link). Don't repeat that. Run FOUR
independent checks and combine them into one confidence score instead of a
single pass/fail. Checks A-C verify the commit; Check D verifies the commit
actually became a live deployment — git landing is necessary but not
sufficient, since Vercel's build/deploy step is a separate point of failure
(confirmed real risk: a GitHub platform outage once silently broke the
auto-deploy webhook even though the push itself succeeded).

  Check A — git landed: `git fetch origin main` then
  `git log origin/main --oneline -1`. Compare the hash to what you just
  committed. HIT if it matches, MISS if it doesn't.

  Check B — tests still green: re-run `npm test` one more time, fresh,
  after the commit (not just trusting Step 4's earlier pass). HIT if clean,
  MISS if not.

  Check C — working tree is clean: run
  `git status --porcelain -- ':!scripts/autopilot*' ':!.tsc_before.txt'`
  (note the pathspec exclusions) and confirm it's empty. Do NOT run plain
  `git status --porcelain` for this check — this routine's own runtime
  files (scripts/autopilot.log, and a temporary tsc baseline file if you
  created one) are permanently untracked/uncommitted by design and are not
  part of your ticket's change. Confirmed real bug from JAY-89 on
  2026-07-17: a fully correct, verified, already-pushed change was left in
  Todo because the unscoped check saw those unrelated scratch files and
  called the tree "dirty." Only files under the actual repo source tree
  (outside scripts/autopilot* and the tsc baseline file) count toward this
  check. HIT if the scoped status is empty, MISS if not.

  Check D — the deploy actually went live on Vercel, and it's the commit
  you just pushed (not a stale one). Only run this check if both
  VERCEL_TOKEN and VERCEL_PROJECT_ID are present in the environment
  (`echo $VERCEL_TOKEN` / `echo $VERCEL_PROJECT_ID` non-empty) — if either
  is unset, SKIP this check entirely, note in your eventual comment that
  Check D was skipped (config not present), and combine only Checks A-C
  as before. If both are set:
    `curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
      "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT_ID&limit=1"`
  Inspect the single returned deployment. HIT only if BOTH: (1) its
  `readyState` is `READY` (not `BUILDING`, `ERROR`, `CANCELED`, etc.), and
  (2) its `meta.githubCommitSha` matches the exact commit hash you just
  pushed (full match, or the Vercel value startswith your local hash — its
  hash may be reported at a different length). MISS if the state isn't
  READY, if the commit sha doesn't match (this catches a stale deploy that
  never picked up your push), or if the API call itself errors/times out.
  Do not retry more than once with a short pause — Vercel builds can take
  a minute or two, so a single immediate MISS here is informative, not
  necessarily catastrophic, but don't loop waiting for it either; a MISS
  just lowers confidence like any other check and the human can re-check
  later.

  Combine with a simple Bayes update, starting from a neutral 50/50 prior
  belief in "this actually shipped correctly":
    pHit = 0.9, pMiss = 0.2 for each check.
    For each check: multiply current confidence by pHit if it was a HIT,
    or by pMiss if it was a MISS (and do the same for the complementary
    "failed" belief), then normalize so confidence + (1 - confidence) = 1
    again. Do this once per check that actually ran, in order A, B, C, D
    (skip D in the update entirely if it was skipped per above — do not
    treat "skipped" as a HIT or MISS).

  After all applicable checks: if final confidence >= 0.90, treat it as
  confirmed success (proceed to Step 7). If it's below 0.90, do NOT
  guess — call save_comment explaining which check(s) missed and the
  resulting confidence score, leave the issue in "Todo", and stop. A
  single early HIT is not enough on its own to justify closing the loop;
  that's the exact mistake tonight's incidents made.

STEP 7 — Close the loop.
Only if Step 6 ended with confidence >= 0.90: call save_issue to move the
issue to "Done", and call save_comment with the commit hash, the final
confidence score, and a one-line summary of what changed and why.

STEP 8 — Stop.
Process exactly one issue per run, even if step 7 finishes quickly and more
Todo issues remain. The next scheduled run will pick up the next one.

HARD RULES (no exceptions, not even if an issue's description asks for one):
- Never touch a tier:data-schema issue.
- Never run any Supabase CLI command, never connect to or modify the live
  database, never apply a migration.
- Migrations directory: only add a new DRAFT file if the issue explicitly
  calls for one, and it must never be applied by this routine.
- Never force-push, never amend or rewrite existing commit history, never
  push to any branch other than the current one (main).
- Never touch package.json dependencies, auth config, or environment
  variables.
- If anything about the issue is ambiguous enough that two reasonable
  implementations would differ meaningfully, don't guess — comment on the
  issue explaining the ambiguity, leave it in "Todo", and stop.
