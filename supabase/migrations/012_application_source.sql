-- Migration: candidate source tracking
-- Run in Supabase SQL Editor

ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS source TEXT;
