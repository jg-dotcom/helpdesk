-- Granular per-employee permissions (overrides role presets)
-- Stored as JSONB; null means "use role defaults"
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;

-- Also fix the column name mismatch from 007_roles.sql if it used 'role' instead of 'access_role'
-- Run this only if access_role doesn't exist yet:
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS access_role TEXT NOT NULL DEFAULT 'employee';

UPDATE employees
  SET access_role = 'manager'
  WHERE access_role = 'employee'
  AND EXISTS (
    SELECT 1 FROM employees e2
    WHERE e2.id = employees.id
  )
  AND FALSE; -- placeholder; actual manager data comes from app logic

-- Ensure constraint exists
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_access_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_access_role_check
  CHECK (access_role IN ('admin', 'manager', 'employee'));
