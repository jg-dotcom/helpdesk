-- Add permission_level to employees
-- Values: 'employee' (default) | 'manager'
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS permission_level TEXT NOT NULL DEFAULT 'employee';

-- Constraint to keep values clean
ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_permission_level_check;
ALTER TABLE employees
  ADD CONSTRAINT employees_permission_level_check
  CHECK (permission_level IN ('employee', 'manager'));
