-- ============================================================
-- Chat feature migration
-- Run in Supabase SQL editor
-- ============================================================

-- Messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id          bigserial PRIMARY KEY,
  business_id uuid        NOT NULL,
  channel     text        NOT NULL,   -- 'general' | 'dm_emp_{id}'
  sender_id   uuid        NOT NULL,
  sender_name text        NOT NULL,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_lookup
  ON chat_messages (business_id, channel, created_at DESC);

-- Read receipts (for unread counts)
CREATE TABLE IF NOT EXISTS chat_read_receipts (
  id           bigserial   PRIMARY KEY,
  business_id  uuid        NOT NULL,
  channel      text        NOT NULL,
  user_id      uuid        NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, channel, user_id)
);

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_read_receipts ENABLE ROW LEVEL SECURITY;

-- Owners: full read/write for their business
CREATE POLICY "owner_select_messages" ON chat_messages
  FOR SELECT USING (business_id = auth.uid());

CREATE POLICY "owner_insert_messages" ON chat_messages
  FOR INSERT WITH CHECK (
    business_id = auth.uid()
    AND sender_id = auth.uid()
  );

-- Employees: read general + their own DM channel
CREATE POLICY "employee_select_messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.email = (auth.jwt() ->> 'email')
        AND e.user_id = chat_messages.business_id
        AND (
          chat_messages.channel = 'general'
          OR chat_messages.channel = 'dm_emp_' || e.id::text
        )
    )
  );

-- Employees: insert into channels they belong to
CREATE POLICY "employee_insert_messages" ON chat_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM employees e
      WHERE e.email = (auth.jwt() ->> 'email')
        AND e.user_id = chat_messages.business_id
        AND (
          chat_messages.channel = 'general'
          OR chat_messages.channel = 'dm_emp_' || e.id::text
        )
    )
  );

-- Read receipts: users own their own receipts
CREATE POLICY "own_read_receipts" ON chat_read_receipts
  FOR ALL
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Realtime ─────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
