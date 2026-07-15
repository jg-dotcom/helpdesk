-- JAY-54 (prerequisite step) — add the missing labor-budget input so a
-- "budget vs. actual" comparison can be surfaced on the Schedule page.
-- This is deliberately the smallest possible schema change: one nullable
-- column on business_profiles. No solver/generation-engine schema is
-- proposed here — that decision is still open per the full JAY-54 proposal.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS weekly_labor_budget_cents integer;
