-- JAY-42 — AI assistant conversation history was purely client-side
-- (ChatWidget.tsx `useState<Message[]>([])`), so a page refresh mid-conversation
-- lost everything, including any in-progress multi-turn task. Scope: restore-only
-- (last 20 messages), no thread management (rename/delete/multiple threads) yet —
-- per the ticket's own validation gut-check, that's follow-up work only if usage
-- justifies it.
--
-- Scoped per-user (not per-business) — this is a personal assistant thread, not
-- a shared channel like chat_messages (team messaging, unrelated table).
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  role        text NOT NULL, -- 'user' | 'assistant'
  content     text NOT NULL,
  actions     jsonb,         -- ChatAction[] — tool-call summary cards, if any
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages (user_id, created_at DESC);

ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_manage_own_ai_chat_messages" ON ai_chat_messages
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
