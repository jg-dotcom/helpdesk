-- Migration: Shift scheduling features
-- Run in Supabase SQL Editor

-- Feature: Open shift pool
-- Allow shifts with no assigned employee (is_open_shift = true, employee_id = null)
ALTER TABLE shifts ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_open_shift BOOLEAN DEFAULT false;

-- Feature: Shift swap requests
CREATE TABLE IF NOT EXISTS shift_swaps (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  requester_employee_id BIGINT NOT NULL,
  requester_shift_id BIGINT NOT NULL,
  target_employee_id BIGINT,
  target_shift_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for shift_swaps: owner can read/update their own business's swaps
ALTER TABLE shift_swaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_shift_swaps" ON shift_swaps
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
