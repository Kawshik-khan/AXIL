-- 008: one round trip per write (ADR-109 follow-up). Measured before this: a write request made 8–12 sequential round
-- trips to Postgres (BEGIN, one statement per changed collection, sequences, the advisory lock, the change log, COMMIT),
-- about 2–4 s from a machine far from the database. commerceos.apply_changes() does the same versioned write inside the
-- database, as one statement:
--   - deletes, then updates and inserts, in the order given (parents before children), each only where the row still has
--     the version the server last saw; an update never moves a row to another tenant; an insert never overwrites a row
--     someone else created;
--   - order sequences and store metadata, version-checked the same way;
--   - any mismatch: nothing is written, SQLSTATE P0409 with the conflicting [collection, id] pairs as JSON in DETAIL;
--   - every written row is appended to commerceos.changes under the advisory lock, so change-log positions follow
--     commit order across servers;
--   - returns the written rows as [[collection, id, version], ...] (version 0: deleted).
-- Table names are passed by the store from its fixed collection → table map and quoted with %I. Servers without this
-- function (not yet migrated) keep writing statement by statement.

CREATE OR REPLACE FUNCTION commerceos.apply_changes(p_changes jsonb, p_writer text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  op jsonb;
  coll text;
  tbl text;
  done jsonb;
  seq_coll text := coalesce(p_changes->>'sequence_collection', 'order_sequences');
  written jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  r jsonb;
  v bigint;
BEGIN
  -- Deletes, children first (the store sends them in that order)
  FOR op IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'deletes', '[]'::jsonb)) AS e LOOP
    coll := op->>'collection';
    tbl := op->>'table';
    IF tbl IS NOT NULL THEN
      EXECUTE format(
        'WITH d AS (DELETE FROM commerceos.%I t USING jsonb_to_recordset($1) AS u(id text, version bigint)
                     WHERE t.id = u.id AND t.version = u.version RETURNING t.id)
         SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM d', tbl)
        INTO done USING op->'rows';
    ELSE
      EXECUTE
        'WITH d AS (DELETE FROM commerceos.documents t USING jsonb_to_recordset($1) AS u(id text, version bigint)
                     WHERE t.collection = $2 AND t.id = u.id AND t.version = u.version RETURNING t.id)
         SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM d'
        INTO done USING op->'rows', coll;
    END IF;
    written := written || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, x, 0)) FROM jsonb_array_elements_text(done) AS x), '[]'::jsonb);
    conflicts := conflicts || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, e->>'id')) FROM jsonb_array_elements(op->'rows') AS e WHERE NOT done ? (e->>'id')), '[]'::jsonb);
  END LOOP;

  -- Updates and inserts, parents first
  FOR op IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'upserts', '[]'::jsonb)) AS e LOOP
    coll := op->>'collection';
    tbl := op->>'table';
    IF jsonb_array_length(coalesce(op->'updates', '[]'::jsonb)) > 0 THEN
      IF tbl IS NOT NULL THEN
        EXECUTE format(
          'WITH w AS (UPDATE commerceos.%I t
                         SET data = u.data, created_at = u.created_at, version = t.version + 1, row_updated_at = now()
                        FROM jsonb_to_recordset($1) AS u(id text, version bigint, tenant_id text, created_at timestamptz, data jsonb)
                       WHERE t.id = u.id AND t.version = u.version AND t.tenant_id IS NOT DISTINCT FROM u.tenant_id
                   RETURNING t.id, t.version)
           SELECT coalesce(jsonb_object_agg(id, version), ''{}''::jsonb) FROM w', tbl)
          INTO done USING op->'updates';
      ELSE
        EXECUTE
          'WITH w AS (UPDATE commerceos.documents t
                         SET data = u.data, created_at = u.created_at, version = t.version + 1, row_updated_at = now()
                        FROM jsonb_to_recordset($1) AS u(id text, version bigint, tenant_id text, created_at timestamptz, data jsonb)
                       WHERE t.collection = $2 AND t.id = u.id AND t.version = u.version AND t.tenant_id IS NOT DISTINCT FROM u.tenant_id
                   RETURNING t.id, t.version)
           SELECT coalesce(jsonb_object_agg(id, version), ''{}''::jsonb) FROM w'
          INTO done USING op->'updates', coll;
      END IF;
      written := written || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, k, (done->>k)::bigint)) FROM jsonb_object_keys(done) AS k), '[]'::jsonb);
      conflicts := conflicts || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, e->>'id')) FROM jsonb_array_elements(op->'updates') AS e WHERE NOT done ? (e->>'id')), '[]'::jsonb);
    END IF;
    IF jsonb_array_length(coalesce(op->'inserts', '[]'::jsonb)) > 0 THEN
      IF tbl IS NOT NULL THEN
        EXECUTE format(
          'WITH w AS (INSERT INTO commerceos.%I (id, tenant_id, created_at, data)
                      SELECT e->>''id'', e->>''tenant_id'', (e->>''created_at'')::timestamptz, e->''data''
                        FROM jsonb_array_elements($1) WITH ORDINALITY AS a(e, ord) ORDER BY ord
                      ON CONFLICT (id) DO NOTHING
                      RETURNING id, version)
           SELECT coalesce(jsonb_object_agg(id, version), ''{}''::jsonb) FROM w', tbl)
          INTO done USING op->'inserts';
      ELSE
        EXECUTE
          'WITH w AS (INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data)
                      SELECT $2, e->>''id'', e->>''tenant_id'', (e->>''created_at'')::timestamptz, e->''data''
                        FROM jsonb_array_elements($1) WITH ORDINALITY AS a(e, ord) ORDER BY ord
                      ON CONFLICT (collection, id) DO NOTHING
                      RETURNING id, version)
           SELECT coalesce(jsonb_object_agg(id, version), ''{}''::jsonb) FROM w'
          INTO done USING op->'inserts', coll;
      END IF;
      written := written || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, k, (done->>k)::bigint)) FROM jsonb_object_keys(done) AS k), '[]'::jsonb);
      conflicts := conflicts || coalesce((SELECT jsonb_agg(jsonb_build_array(coll, e->>'id')) FROM jsonb_array_elements(op->'inserts') AS e WHERE NOT done ? (e->>'id')), '[]'::jsonb);
    END IF;
  END LOOP;

  -- Order sequences
  FOR r IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'sequence_deletes', '[]'::jsonb)) AS e LOOP
    DELETE FROM commerceos.order_sequences WHERE tenant_id = r->>'id' AND version = (r->>'expected')::bigint;
    IF FOUND THEN written := written || jsonb_build_array(jsonb_build_array(seq_coll, r->>'id', 0));
    ELSE conflicts := conflicts || jsonb_build_array(jsonb_build_array(seq_coll, r->>'id')); END IF;
  END LOOP;
  FOR r IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'sequence_upserts', '[]'::jsonb)) AS e LOOP
    v := NULL;
    IF r->'expected' IS NULL OR jsonb_typeof(r->'expected') = 'null' THEN
      INSERT INTO commerceos.order_sequences (tenant_id, value) VALUES (r->>'id', (r->>'value')::bigint)
        ON CONFLICT (tenant_id) DO NOTHING RETURNING version INTO v;
    ELSE
      UPDATE commerceos.order_sequences SET value = (r->>'value')::bigint, version = version + 1, row_updated_at = now()
       WHERE tenant_id = r->>'id' AND version = (r->>'expected')::bigint RETURNING version INTO v;
    END IF;
    IF v IS NOT NULL THEN written := written || jsonb_build_array(jsonb_build_array(seq_coll, r->>'id', v));
    ELSE conflicts := conflicts || jsonb_build_array(jsonb_build_array(seq_coll, r->>'id')); END IF;
  END LOOP;

  -- Store metadata
  FOR r IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'meta_deletes', '[]'::jsonb)) AS e LOOP
    DELETE FROM commerceos.store_meta WHERE key = r->>'id' AND version = (r->>'expected')::bigint;
    IF FOUND THEN written := written || jsonb_build_array(jsonb_build_array('store_meta', r->>'id', 0));
    ELSE conflicts := conflicts || jsonb_build_array(jsonb_build_array('store_meta', r->>'id')); END IF;
  END LOOP;
  FOR r IN SELECT e FROM jsonb_array_elements(coalesce(p_changes->'meta_upserts', '[]'::jsonb)) AS e LOOP
    v := NULL;
    IF r->'expected' IS NULL OR jsonb_typeof(r->'expected') = 'null' THEN
      INSERT INTO commerceos.store_meta (key, value) VALUES (r->>'id', r->'value')
        ON CONFLICT (key) DO NOTHING RETURNING version INTO v;
    ELSE
      UPDATE commerceos.store_meta SET value = r->'value', version = version + 1, row_updated_at = now()
       WHERE key = r->>'id' AND version = (r->>'expected')::bigint RETURNING version INTO v;
    END IF;
    IF v IS NOT NULL THEN written := written || jsonb_build_array(jsonb_build_array('store_meta', r->>'id', v));
    ELSE conflicts := conflicts || jsonb_build_array(jsonb_build_array('store_meta', r->>'id')); END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    RAISE EXCEPTION 'store conflict' USING ERRCODE = 'P0409', DETAIL = conflicts::text;
  END IF;

  -- Change log, in commit order across servers
  IF jsonb_array_length(written) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('commerceos_changes'));
    INSERT INTO commerceos.changes (writer, collection, id, op)
    SELECT p_writer, w->>0, w->>1, CASE WHEN (w->>2)::bigint = 0 THEN 'delete' ELSE 'upsert' END
      FROM jsonb_array_elements(written) WITH ORDINALITY AS a(w, ord)
     ORDER BY ord;
  END IF;
  RETURN written;
END
$fn$;
