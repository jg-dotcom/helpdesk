-- JAY-49 — Stripe guarantees at-least-once webhook delivery and retries on
-- any non-200 response. Today's handler logic happens to be idempotent by
-- accident (plain `update()`, not additive), but there's no record proving
-- an event was applied once, so the next additive billing feature (crediting
-- an invoice, granting bonus trial days, etc.) would silently double-apply
-- on a Stripe retry. Standard fix: store the event id with a UNIQUE
-- constraint and check-and-insert atomically before processing.
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  id TEXT PRIMARY KEY, -- Stripe event.id, e.g. "evt_1AbCdEf..."
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);
