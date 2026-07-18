-- JAY-123 — PTO accrual model. DRAFT migration — not applied. Review and
-- run manually against Supabase.
--
-- Adds a per-business PTO accrual policy. Defaults preserve today's
-- behavior exactly (method='flat' = the old flat pto_days_per_year grant);
-- owners opt into monthly proration from Settings.
--
-- Note: employees already has a `start` date column (used for tenure
-- display on the employee profile page), which doubles as hire date for
-- proration purposes — no new column needed on employees.

alter table business_profiles
  add column if not exists pto_accrual_method text not null default 'flat'
    check (pto_accrual_method in ('flat', 'monthly')),
  add column if not exists pto_accrual_rate numeric(4,2) default 1.25,
  add column if not exists pto_rollover_cap numeric(5,2); -- nullable = no cap; reserved for a future year-end rollover job, not yet applied to balances
