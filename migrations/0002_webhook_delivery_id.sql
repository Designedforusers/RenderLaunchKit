-- Add a `delivery_id` column to webhook_events for replay protection.
--
-- Stores the GitHub `x-github-delivery` header that uniquely identifies
-- each delivery (including manual redeliveries from the GitHub UI). The
-- webhook receiver dedupes on this column before queuing background work,
-- so a replayed payload becomes a no-op rather than a duplicate job.
--
-- The unique index allows NULL values, so any pre-existing rows from
-- before this migration ran are preserved.

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS delivery_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_delivery_id_idx
  ON webhook_events(delivery_id)
  WHERE delivery_id IS NOT NULL;
