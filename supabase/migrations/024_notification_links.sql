-- Migration: JAY-60 — notifications become click-through links
-- Nullable so existing rows (and any insert site not yet updated) are unaffected.
-- Run in Supabase SQL Editor

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
