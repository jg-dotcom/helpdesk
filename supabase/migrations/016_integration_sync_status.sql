-- JAY-46 — persist sync outcome so it survives a page refresh. Today the only
-- persisted timestamp is `connected_at` (when OAuth was first completed);
-- there is no record of whether the last sync succeeded or when it ran.
ALTER TABLE gusto_connections
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_summary jsonb;

ALTER TABLE google_connections
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_summary jsonb;

ALTER TABLE quickbooks_connections
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_summary jsonb;

-- last_sync_summary shape: { "count": number, "errors": number, "label": text }
-- e.g. { "count": 4, "errors": 1, "label": "pushed" }
