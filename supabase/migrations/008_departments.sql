-- Departments system
CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#185fa5',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS departments_user_id_idx ON departments(user_id);

-- Many-to-many: employees ↔ departments
CREATE TABLE IF NOT EXISTS department_members (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(employee_id, department_id)
);

CREATE INDEX IF NOT EXISTS dept_members_employee_idx ON department_members(employee_id);
CREATE INDEX IF NOT EXISTS dept_members_dept_idx ON department_members(department_id);

-- RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_departments" ON departments
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "owner_all_dept_members" ON department_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM departments d
      WHERE d.id = department_members.department_id
      AND d.user_id = auth.uid()
    )
  );
