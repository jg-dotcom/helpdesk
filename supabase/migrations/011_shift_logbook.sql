-- Migration: Manager logbook (per-day shift notes)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS shift_notes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  shift_date DATE NOT NULL,
  author_name TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_notes_user_date_idx ON shift_notes (user_id, shift_date);

ALTER TABLE shift_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_shift_notes" ON shift_notes
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
