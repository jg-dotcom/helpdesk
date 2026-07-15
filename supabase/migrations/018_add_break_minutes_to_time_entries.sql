-- JAY-32 — Optional unpaid break deduction on time entries.
-- No break/meal-period concept existed anywhere in the schema; an employee
-- working an 8-hour shift with an unpaid 30-minute lunch had no way to
-- represent that, so payroll calculated gross pay off the full clocked
-- duration. Scoped deliberately narrow per the ticket's validation
-- gut-check: a single optional minutes field on the existing time-entry
-- edit flow, not a dedicated break clock-in/out UI or state-specific
-- compliance logic.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS break_minutes integer NOT NULL DEFAULT 0;
