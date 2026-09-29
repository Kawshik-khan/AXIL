-- ============================================================
-- CommerceOS Migration 007: several app servers on one store (FIX_IMPLEMENTATION_PLAN FX-45, ADR-109)
--
-- Every server keeps its in-memory copy of the store; each request commits its changes before it responds:
--   - `version` on every stored row: a write succeeds only if the row still has the version the server last saw,
--     so two servers can never overwrite each other's changes (the second gets 409 and retries);
--   - `commerceos.changes`: one entry per written row, in commit order; servers read it to refresh their copy;
--   - `commerceos.store_state`: the store epoch (a backfill changes it, and every server reloads) and the prune mark
--     (a server that fell behind the pruned part of the change log reloads).
--
-- The tables of the single-writer design (store_writer lease, refused_rows) stay, unused, so the previous release can
-- still start against this schema if it has to be rolled back.
-- ============================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'commerceos' AND c.column_name = 'data' AND c.table_name <> 'refused_rows'
  LOOP
    EXECUTE format('ALTER TABLE commerceos.%I ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1', t.table_name);
  END LOOP;
END $$;

ALTER TABLE commerceos.order_sequences ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE commerceos.store_meta ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS commerceos.changes (
    seq         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    writer      text        NOT NULL,
    collection  text        NOT NULL,
    id          text        NOT NULL,
    op          text        NOT NULL CHECK (op IN ('upsert', 'delete')),
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS changes_at_idx ON commerceos.changes (at);

-- Rate-limit counters shared by every server (sign-in guessing counts on all of them). Keys are SHA-256 hashes.
CREATE TABLE IF NOT EXISTS commerceos.rate_limits (
    key           text    NOT NULL,
    window_start  bigint  NOT NULL,
    hits          integer NOT NULL,
    PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS commerceos.store_state (
    id              integer PRIMARY KEY CHECK (id = 1),
    epoch           text    NOT NULL,
    pruned_through  bigint  NOT NULL DEFAULT 0
);
INSERT INTO commerceos.store_state (id, epoch)
VALUES (1, md5(random()::text || clock_timestamp()::text))
ON CONFLICT (id) DO NOTHING;
