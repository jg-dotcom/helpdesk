-- JAY-115 — off-cycle payroll runs (bonus/correction/one-off pay). DRAFT
-- migration — not applied. Review and run manually against Supabase.
--
-- Off-cycle runs go through the same payroll_runs/payroll_run_items tables
-- as a regular run (avoiding the JAY-88 "second parallel ledger" mistake),
-- tagged with run_type + an optional reason, and scoped to a caller-chosen
-- subset of employees rather than "everyone active in the period."

alter table payroll_runs
  add column if not exists run_type text not null default 'regular'
    check (run_type in ('regular', 'off_cycle')),
  add column if not exists reason text; -- e.g. 'Bonus' / 'Correction' / 'Other', off_cycle runs only

-- JAY-48's one-finalized-run-per-period guard was never meant to block a
-- legitimate off-cycle bonus/correction covering a period that already has
-- a regular finalized run — rescope it to regular runs only.
drop index if exists payroll_runs_one_finalized_per_period;

create unique index if not exists payroll_runs_one_finalized_per_period
  on payroll_runs (user_id, period_start, period_end)
  where status = 'finalized' and run_type = 'regular';
