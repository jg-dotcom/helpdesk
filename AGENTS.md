<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing protocol

See `TESTING.md` for the full protocol (unit vs. integration conventions, mocking patterns, coverage status).

**Standing rule: after any code change — bug fix, refactor, or new feature — check whether it needs new or updated tests, and add them.** This applies to both layers:

- New or changed logic in `src/lib/*.ts` → add/update a unit test in `src/__tests__/*.test.ts`.
- New or changed route handler in `src/app/api/**/route.ts` → add/update an integration test in `src/__tests__/api/*.test.ts`, following the mocking pattern in `src/__tests__/helpers/supabaseMock.ts`.

Don't wait to be asked. If a change doesn't need a test (e.g. a pure styling/UI tweak with no logic), say so briefly rather than skipping the check silently. Run `npm test` before considering any change done.

**Before every commit:** run the full suite (`npm test`) and confirm it passes. If any feature was added or changed since the last commit and doesn't have tests yet, write them now, per the rule above, then re-run the suite before committing. A local pre-commit hook enforces the "suite passes" half of this automatically — see below.

# Competitive-grounding protocol

This app is built and maintained by a single person competing against category leaders with full design/product teams (Gusto, Rippling, BambooHR, Greenhouse, Lever, Workable, Pinpoint, 7shifts, Homebase, Deputy, Slack, etc.). The way to compete from that position is to borrow what the leader in each category already got right, then find the one or two things about our implementation that can be better (simpler, faster, more opinionated, cheaper to build) — not to guess at features in a vacuum.

**Standing rule: whenever proposing a new feature, redesign, or UI/UX change for any page or module, first identify which existing product is the recognized best-in-class for that specific thing, research it (WebSearch — don't rely on training-data guesses, since pricing/features/UI change), and use that research to ground the recommendation.** Concretely:

- Name the 1-3 leaders for that specific surface (e.g. payroll → Gusto/Rippling; ATS/hiring → Greenhouse/Lever/Pinpoint; scheduling → 7shifts/Homebase/Deputy; chat → Slack/Teams; HR dashboard → BambooHR/Rippling).
- Search for what they actually do in that surface before recommending anything — don't present unresearched ideas as if they were informed by the category leader.
- Explicitly call out what we should borrow as-is, and where we can do better given our advantages (single opinionated dark UI already shared across the whole app, no enterprise sales-driven feature bloat, faster iteration since there's no committee).
- Don't just list what leaders do — synthesize a specific recommendation for this codebase (which file/page, what changes) that explains why it beats a plain copy.

This applies to every "what's missing," "redesign this page," or "what should we add" conversation, not just Hiring/Payroll (where this was first done). Skipping the research step and jumping straight to a features list is not acceptable — ideas without competitive grounding are guesses.

# Architecture direction: API-first data layer

Long-term goal, agreed with the owner: make this codebase easy to maintain and easy to transfer logic to a future mobile app (an Expo scaffold already exists at `helpdesk/mobile`). The chosen priority, in order:

1. **API-first data layer.** Every page currently mixes two patterns inconsistently — some pages (`time/page.tsx`, `hiring/page.tsx`, etc.) call `supabase.from(...)` directly from the browser client; others go through `src/app/api/**/route.ts` handlers with `getBearerUser`. Only the API-route pattern is transferable to a mobile client (a mobile app can't safely replicate ad hoc client-side Supabase queries + assumed RLS behavior). **Standing rule going forward: new data access and any business logic (hours math, staleness/overtime thresholds, PTO calculations, etc.) should go through an API route and a shared `src/lib/` function, not a direct `supabase.from(...)` call inside a page component.** When touching a page that still uses the direct-Supabase pattern for something you're already editing, prefer migrating that specific piece to the API-route pattern rather than adding more direct calls next to it — but don't do a drive-by rewrite of an entire page's data layer as a side effect of an unrelated task; call it out and ask first.
2. **Shared types** (not yet started) — pull duplicated per-page type declarations (`Employee`, `Application`, `Channel`, etc.) into one shared module once the API layer stabilizes, so they can't drift from the real schema (this already caused one bug: `pto_days_per_year` missing from `time/page.tsx`'s `Employee` type).
3. **Schema/migration cleanup** (not yet started, lower urgency) — several real columns/tables exist in the live database but were never captured in `supabase/migrations/` (`pto_days_per_year`, `payroll_entries`, `business_profiles`, `job_applications`'s base table). `supabase/migrations/` is not currently a reliable from-scratch source of truth for the schema.

This is a direction to lean into incrementally as work touches these areas, not a mandate to stop and refactor everything immediately.
