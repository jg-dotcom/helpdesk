-- JAY-48 — prevent a second FINALIZED payroll run from ever existing for the
-- same (user_id, period_start, period_end). Draft runs are deliberately left
-- unrestricted (an owner may want to regenerate a draft preview several times
-- before finalizing), so this is a partial unique index scoped to
-- status = 'finalized' rather than a plain UNIQUE constraint across all rows.
-- Defense in depth alongside the application-level check in
-- POST /api/payroll/run — the app check is what actually produces a helpful
-- error message; this index is the guarantee if that check is ever bypassed
-- (e.g. a concurrent request race).
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_one_finalized_per_period
  ON payroll_runs (user_id, period_start, period_end)
  WHERE status = 'finalized';
