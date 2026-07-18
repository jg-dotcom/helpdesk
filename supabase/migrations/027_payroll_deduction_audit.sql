-- JAY-118 — audit trail for manual deduction edits on payroll_run_items.
-- DRAFT migration — not applied. Review and run manually against Supabase.
--
-- Every time someone edits an item's deductions via
-- PATCH /api/payroll/run/[id] (the deduction-update branch), we now record
-- who changed it, when, and the before/after deduction breakdown + resulting
-- net pay. This lets the payroll UI show "Last edited by X on <date>" and
-- gives owners a real trail if a deduction total is ever disputed.

create table if not exists payroll_deduction_audit (
  id bigint generated always as identity primary key,
  payroll_run_item_id integer not null references payroll_run_items(id) on delete cascade,
  user_id uuid not null references auth.users(id), -- account owner, matches payroll_run_items.user_id
  edited_by uuid not null references auth.users(id), -- who made this specific edit
  old_deductions jsonb,
  new_deductions jsonb not null,
  old_net_pay numeric(12,2),
  new_net_pay numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists payroll_deduction_audit_item_idx
  on payroll_deduction_audit(payroll_run_item_id, created_at desc);

alter table payroll_deduction_audit enable row level security;

create policy "owners can read their own audit rows"
  on payroll_deduction_audit for select
  using (auth.uid() = user_id);

-- Inserts happen via the server (supabaseAdmin, service role), so no insert
-- policy is needed for authenticated clients.
