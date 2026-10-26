-- 012: durable outbound delivery (ADR-122, messaging reliability MR5). The message row is the outbox: the delivery pass
-- scans outbound messages that are QUEUED (due) or SENDING (claimed). These generated columns and the partial index keep
-- that scan cheap once messages are no longer hydrated at boot. The values stay in `data` like every message field.
--
-- Forward-only, additive. Rollback:
--   DROP INDEX IF EXISTS commerceos.messages_undelivered_idx;
--   ALTER TABLE commerceos.messages DROP COLUMN IF EXISTS delivery_status, DROP COLUMN IF EXISTS direction,
--     DROP COLUMN IF EXISTS next_attempt_at;

ALTER TABLE commerceos.messages
    ADD COLUMN IF NOT EXISTS direction text GENERATED ALWAYS AS (data->>'direction') STORED;
ALTER TABLE commerceos.messages
    ADD COLUMN IF NOT EXISTS delivery_status text GENERATED ALWAYS AS (data->>'status') STORED;
ALTER TABLE commerceos.messages
    ADD COLUMN IF NOT EXISTS next_attempt_at text GENERATED ALWAYS AS (data->'delivery'->>'next_attempt_at') STORED;
CREATE INDEX IF NOT EXISTS messages_undelivered_idx
    ON commerceos.messages (next_attempt_at, created_at)
    WHERE direction = 'OUTBOUND' AND delivery_status IN ('QUEUED', 'SENDING');
