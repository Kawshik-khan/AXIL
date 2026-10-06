-- 009: customer agent (ADR-111). Orders placed by the customer agent record the conversation and channel identity they
-- came from; the agent finds a chat's orders through these, never through a phone number typed in the chat. The values
-- live in the row's `data` like every other order field; these generated columns only make them queryable and indexed.
-- Quotes (FX-73) are a store collection kept as JSONB documents in commerceos.documents, so they need no table.
--
-- Forward-only. Rollback:
--   DROP INDEX IF EXISTS commerceos.orders_source_conversation_idx;
--   ALTER TABLE commerceos.orders DROP COLUMN IF EXISTS source_conversation_id, DROP COLUMN IF EXISTS source_identity_id;

ALTER TABLE commerceos.orders
    ADD COLUMN IF NOT EXISTS source_conversation_id text GENERATED ALWAYS AS (data->>'source_conversation_id') STORED;
ALTER TABLE commerceos.orders
    ADD COLUMN IF NOT EXISTS source_identity_id text GENERATED ALWAYS AS (data->>'source_identity_id') STORED;
CREATE INDEX IF NOT EXISTS orders_source_conversation_idx
    ON commerceos.orders (tenant_id, source_conversation_id) WHERE source_conversation_id IS NOT NULL;
