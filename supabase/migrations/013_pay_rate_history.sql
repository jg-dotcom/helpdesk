-- JAY-51 — pay_rate history so payroll runs can split hours by the rate
-- actually in effect on each worked day, instead of applying whatever rate
-- happens to be current at run-time to the entire pay period.
--
-- Model: one row per rate that ever took effect, keyed by employee + the
-- date it started applying. To find the rate in effect on a given day,
-- take the most recent row with effective_from <= that day. If an employee
-- has zero rows (never had a logged change), payroll/run falls back to the
-- employee's current pay_rate for the whole period — same behavior as today.
CREATE TABLE IF NOT EXISTS pay_rate_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  employee_id BIGINT NOT NULL,
  pay_rate NUMERIC NOT NULL,
  pay_type TEXT NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pay_rate_history_emp_idx ON pay_rate_history (employee_id, effective_from);

ALTER TABLE pay_rate_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_pay_rate_history" ON pay_rate_history
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
