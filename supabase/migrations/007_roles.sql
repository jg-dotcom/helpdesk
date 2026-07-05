-- Replace permission_level with a proper role column
-- Roles: 'owner' (identified by business_profiles, not stored here)
--        'admin'   - full dashboard, no billing/danger
--        'manager' - limited dashboard, no payroll/settings
--        'employee' - portal only

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';

-- Migrate existing permission_level data
UPDATE employees SET role = 'manager' WHERE permission_level = 'manager';

-- Drop old column
ALTER TABLE employees DROP COLUMN IF EXISTS permission_level;

-- Constraint
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('admin', 'manager', 'employee'));
