/**
 * Postgres persistence for the store (FIX_IMPLEMENTATION_PLAN FX-42/FX-44/FX-45, ADR-108, ADR-109).
 *
 * Every app server keeps the store's working set in memory and uses Postgres as the system of record:
 *   - load():            reads every table (with each row's version) and the change-log position, in one snapshot;
 *   - computeChanges():  compares records with what this server last committed or saw, and collects changed and removed rows;
 *   - write():           writes them in ONE transaction; each row is written only if it still has the version this
 *                        server last saw, so two servers never overwrite each other (StoreConflictError instead);
 *                        every written row is appended to commerceos.changes, in commit order;
 *   - sync():            reads the other servers' entries from commerceos.changes and fetches those rows;
 *   - restore():         puts memory back to the last committed version of the given rows (a request that failed).
 */
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { type SqlClient, type SqlExecutor } from "./sql-client";
import {
  CORE_TABLES,
  NEWEST_FIRST_COLLECTIONS,
  ORDER_SEQUENCES_KEY,
  coreTableFor,
  qualified,
  recordId,
  storeTablesChildrenFirst,
  type CoreTable,
} from "./store-schema";

const BATCH_ROWS = 500;
/** More foreign changes than this since the last sync: reload everything instead of fetching row by row. */
const SYNC_MAX_ROWS = 20_000;
/** Change-log entries older than this are pruned (a server further behind reloads). */
const CHANGE_LOG_RETENTION = "1 hour";
const PRUNE_EVERY_MS = 5 * 60_000;

/** Another server changed (or created, or deleted) a row this write depends on. Nothing was written. */
export class StoreConflictError extends Error {
  readonly code = "STORE_CONFLICT";
  constructor(readonly rows: Array<{ collection: string; id: string }>) {
    super(`${rows.length} record(s) were changed by another request first: ${rows.slice(0, 5).map((r) => `${r.collection}/${r.id}`).join(", ")}`);
  }
}

interface PendingRow {
  id: string;
  tenantId: string | null;
  createdAt: string | null;
  json: string;
  /** The version this server last saw; null for a new row. */
  expected: number | null;
}

interface CollectionChanges {
  collection: string;
  core: CoreTable | undefined;
  upserts: PendingRow[];
  deletes: Array<{ id: string; expected: number }>;
}

export interface RejectedRow {
  collection: string;
  id: string;
  op: "upsert" | "delete";
  /** MISSING_ID / DUPLICATE_ID / NOT_SERIALIZABLE: records that can't be stored at all. */
  reason: string;
  constraint?: string;
}

export interface ChangeSet {
  collections: CollectionChanges[];
  sequences: { upserts: Array<{ tenantId: string; value: number; expected: number | null }>; deletes: Array<{ tenantId: string; expected: number }> };
  meta: { upserts: Array<{ key: string; json: string; expected: number | null }>; deletes: Array<{ key: string; expected: number }> };
  /** Records that can't be stored at all (no id, a repeated id): reported, never sent. */
  unwritable: RejectedRow[];
  rowCount: number;
  sanitizedRows: number;
}

export interface SyncedRow {
  collection: string;
  id: string;
  /** null: the row was deleted. */
  record: unknown;
}

export interface SyncResult {
  /** The store was replaced (backfill) or this server fell behind the pruned change log: load everything again. */
  reload: boolean;
  rows: SyncedRow[];
}

const NEEDS_CLEANING = /\\u0000|\\ud[89a-f]/i;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const TIME_FIELDS = ["created_at", "timestamp", "started_at", "first_seen_at", "requested_at", "updated_at"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * JSON for one record. Postgres jsonb can't hold NUL characters or half of a surrogate pair (an emoji cut by a
 * `.slice()`), so those are removed / replaced with U+FFFD instead of failing every write.
 */
export function serializeRecord(row: unknown): { json: string; sanitized: boolean } {
  const json = JSON.stringify(row);
  if (!NEEDS_CLEANING.test(json)) return { json, sanitized: false };
  const clean = JSON.stringify(row, (_key, value: unknown) =>
    typeof value === "string" ? value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "�") : value
  );
  return { json: clean, sanitized: clean !== json };
}

function rowTime(row: Record<string, unknown>): string | null {
  for (const field of TIME_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) return new Date(ms).toISOString();
    }
  }
  return null;
}

function tenantOf(core: CoreTable | undefined, row: Record<string, unknown>, id: string): string | null {
  if (core?.tenant === "self") return id;
  return typeof row.tenant_id === "string" && row.tenant_id ? row.tenant_id : null;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Committed {
  json: string;
  version: number;
}

export class PgStorePersistence {
  /** Identifies this server in commerceos.changes (its own entries are skipped by sync). */
  readonly writerId = crypto.randomUUID();
  /** What Postgres holds, as this server last committed or saw it: collection → id → record JSON + version. */
  private readonly committed = new Map<string, Map<string, Committed>>();
  private readonly committedSequences = new Map<string, { value: number; version: number }>();
  private readonly committedMeta = new Map<string, Committed>();
  private epoch: string | null = null;
  private lastSeq = 0;
  private lastPruneAt = 0;
  private lastUnwritable: RejectedRow[] = [];

  constructor(readonly client: SqlClient) {}

  async schemaPresent(): Promise<boolean> {
    const result = await this.client.query<{ present: boolean }>(
      "SELECT to_regclass('commerceos.documents') IS NOT NULL AND to_regclass('commerceos.changes') IS NOT NULL AND to_regclass('commerceos.store_state') IS NOT NULL AS present"
    );
    return result.rows[0]?.present === true;
  }

  /** Entries written to the change log by other servers in the last `seconds` (backfill refuses while an app writes). */
  async recentForeignWrites(seconds: number): Promise<number> {
    const r = await this.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM commerceos.changes WHERE writer <> $1 AND at > now() - ($2::double precision * interval '1 second')",
      [this.writerId, seconds]
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  get position(): { epoch: string | null; seq: number } {
    return { epoch: this.epoch, seq: this.lastSeq };
  }

  // ---- Load --------------------------------------------------------------------------------------------------------

  /** Reads the whole store in one snapshot. The records become the baseline that computeChanges() compares against. */
  async load(): Promise<Record<string, unknown>> {
    return this.client.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      this.committed.clear();
      this.committedSequences.clear();
      this.committedMeta.clear();
      const state = await tx.query<{ epoch: string }>("SELECT epoch FROM commerceos.store_state WHERE id = 1");
      this.epoch = state.rows[0]?.epoch ?? null;
      const seq = await tx.query<{ seq: string }>("SELECT coalesce(max(seq), 0)::text AS seq FROM commerceos.changes");
      this.lastSeq = Number(seq.rows[0]?.seq ?? 0);
      const out: Record<string, unknown> = {};
      for (const [collection, core] of Object.entries(CORE_TABLES) as Array<[string, CoreTable]>) {
        const order = NEWEST_FIRST_COLLECTIONS.has(collection) ? "DESC" : "ASC";
        const result = await tx.query<{ id: string; version: string; data: string }>(
          `SELECT id, version::text AS version, data::text AS data FROM ${qualified(core.table)} ORDER BY seq ${order}`
        );
        out[collection] = this.adopt(collection, result.rows);
      }
      const docs = await tx.query<{ collection: string; id: string; version: string; data: string }>(
        "SELECT collection, id, version::text AS version, data::text AS data FROM commerceos.documents ORDER BY collection, seq"
      );
      const grouped = new Map<string, Array<{ id: string; version: string; data: string }>>();
      for (const row of docs.rows) {
        const list = grouped.get(row.collection) ?? [];
        list.push(row);
        grouped.set(row.collection, list);
      }
      for (const [collection, rows] of grouped) {
        if (NEWEST_FIRST_COLLECTIONS.has(collection)) rows.reverse();
        out[collection] = this.adopt(collection, rows);
      }
      const sequences = await tx.query<{ tenant_id: string; value: string; version: string }>(
        "SELECT tenant_id, value::text AS value, version::text AS version FROM commerceos.order_sequences"
      );
      const seqObject: Record<string, number> = {};
      for (const row of sequences.rows) {
        seqObject[row.tenant_id] = Number(row.value);
        this.committedSequences.set(row.tenant_id, { value: Number(row.value), version: Number(row.version) });
      }
      out[ORDER_SEQUENCES_KEY] = seqObject;
      const meta = await tx.query<{ key: string; value: string; version: string }>(
        "SELECT key, value::text AS value, version::text AS version FROM commerceos.store_meta"
      );
      for (const row of meta.rows) {
        const value: unknown = JSON.parse(row.value);
        out[row.key] = value;
        this.committedMeta.set(row.key, { json: JSON.stringify(value), version: Number(row.version) });
      }
      return out;
    });
  }

  private adopt(collection: string, rows: Array<{ id: string; version: string; data: string }>): unknown[] {
    const committed = new Map<string, Committed>();
    const list: unknown[] = [];
    for (const row of rows) {
      const record: unknown = JSON.parse(row.data);
      committed.set(row.id, { json: JSON.stringify(record), version: Number(row.version) });
      list.push(record);
    }
    this.committed.set(collection, committed);
    return list;
  }

  // ---- Change detection --------------------------------------------------------------------------------------------

  /**
   * Every record whose JSON differs from what was last committed, and every committed record that is gone, in the given
   * collections (all when `only` is omitted). A collection missing from `data` is left alone (never "delete everything").
   */
  computeChanges(data: Record<string, unknown>, only?: ReadonlySet<string>): ChangeSet {
    const changes: ChangeSet = {
      collections: [],
      sequences: { upserts: [], deletes: [] },
      meta: { upserts: [], deletes: [] },
      unwritable: [],
      rowCount: 0,
      sanitizedRows: 0,
    };
    const wanted = (k: string) => !only || only.has(k);
    const coreOrder = Object.keys(CORE_TABLES).filter((k) => k in data && wanted(k));
    const others = Object.keys(data)
      .filter((k) => !coreTableFor(k) && wanted(k))
      .sort();
    for (const collection of [...coreOrder, ...others]) {
      const value = data[collection];
      if (Array.isArray(value)) this.diffCollection(collection, value, changes);
      else if (collection === ORDER_SEQUENCES_KEY && isRecord(value)) this.diffSequences(value, changes);
      else if (value !== undefined) this.diffMeta(collection, value, changes);
    }
    if (!only) this.lastUnwritable = changes.unwritable;
    changes.rowCount =
      changes.collections.reduce((n, c) => n + c.upserts.length + c.deletes.length, 0) +
      changes.sequences.upserts.length +
      changes.sequences.deletes.length +
      changes.meta.upserts.length +
      changes.meta.deletes.length;
    return changes;
  }

  private diffCollection(collection: string, list: unknown[], changes: ChangeSet): void {
    const committed = this.committed.get(collection) ?? new Map<string, Committed>();
    const core = coreTableFor(collection);
    const seen = new Set<string>();
    const out: CollectionChanges = { collection, core, upserts: [], deletes: [] };
    for (const row of list) {
      if (!isRecord(row)) {
        changes.unwritable.push({ collection, id: "", op: "upsert", reason: "NOT_A_RECORD" });
        continue;
      }
      const id = recordId(collection, row);
      if (id === null) {
        changes.unwritable.push({ collection, id: "", op: "upsert", reason: "MISSING_ID" });
        continue;
      }
      if (seen.has(id)) {
        changes.unwritable.push({ collection, id, op: "upsert", reason: "DUPLICATE_ID" });
        continue;
      }
      seen.add(id);
      let serialized: { json: string; sanitized: boolean };
      try {
        serialized = serializeRecord(row);
      } catch {
        changes.unwritable.push({ collection, id, op: "upsert", reason: "NOT_SERIALIZABLE" });
        continue;
      }
      if (serialized.sanitized) changes.sanitizedRows++;
      const known = committed.get(id);
      if (known?.json === serialized.json) continue;
      out.upserts.push({ id, tenantId: tenantOf(core, row, id), createdAt: rowTime(row), json: serialized.json, expected: known?.version ?? null });
    }
    for (const [id, known] of committed) {
      if (!seen.has(id)) out.deletes.push({ id, expected: known.version });
    }
    // Newest-first collections hold new records at the front: insert them oldest first, so the row sequence always grows
    // with recency and load() (which reads these collections by descending sequence) restores the order.
    if (NEWEST_FIRST_COLLECTIONS.has(collection)) out.upserts.reverse();
    if (out.upserts.length || out.deletes.length) changes.collections.push(out);
  }

  private diffSequences(value: Record<string, unknown>, changes: ChangeSet): void {
    const seen = new Set<string>();
    for (const [tenantId, raw] of Object.entries(value)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      seen.add(tenantId);
      const known = this.committedSequences.get(tenantId);
      if (known?.value !== n) changes.sequences.upserts.push({ tenantId, value: n, expected: known?.version ?? null });
    }
    for (const [tenantId, known] of this.committedSequences) {
      if (!seen.has(tenantId)) changes.sequences.deletes.push({ tenantId, expected: known.version });
    }
  }

  private diffMeta(key: string, value: unknown, changes: ChangeSet): void {
    let json: string;
    try {
      json = serializeRecord(value).json;
    } catch {
      changes.unwritable.push({ collection: key, id: "", op: "upsert", reason: "NOT_SERIALIZABLE" });
      return;
    }
    const known = this.committedMeta.get(key);
    if (known?.json !== json) changes.meta.upserts.push({ key, json, expected: known?.version ?? null });
  }

  // ---- Write -------------------------------------------------------------------------------------------------------

  /**
   * Writes a change set in one transaction, each row only if it still has the version this server last saw.
   * `replaceAll` (backfill) empties every store table and the change log first and starts a new epoch, so running
   * servers reload. Throws StoreConflictError (another server changed a row first) or the database's own error (a
   * constraint); in both cases nothing was written and the baseline is unchanged.
   */
  async write(changes: ChangeSet, options: { replaceAll?: boolean } = {}): Promise<{ written: number }> {
    const versions = await this.client.transaction(async (tx) => {
      if (options.replaceAll) {
        await tx.exec(`TRUNCATE ${storeTablesChildrenFirst().map(qualified).join(", ")}, commerceos.changes`);
        await tx.query("UPDATE commerceos.store_state SET epoch = md5(random()::text || clock_timestamp()::text), pruned_through = 0 WHERE id = 1");
      }
      const conflicts: Array<{ collection: string; id: string }> = [];
      const written = new Map<string, Map<string, number>>();
      const note = (collection: string, id: string, version: number) => {
        const m = written.get(collection) ?? new Map<string, number>();
        m.set(id, version);
        written.set(collection, m);
      };
      for (const c of [...changes.collections].reverse()) {
        for (const batch of chunks(c.deletes, BATCH_ROWS)) {
          const done = await this.deleteRows(tx, c, batch, options.replaceAll === true);
          for (const d of batch) {
            if (done.has(d.id)) note(c.collection, d.id, 0);
            else conflicts.push({ collection: c.collection, id: d.id });
          }
        }
      }
      for (const c of changes.collections) {
        const updates = options.replaceAll ? [] : c.upserts.filter((u) => u.expected !== null);
        const inserts = options.replaceAll ? c.upserts : c.upserts.filter((u) => u.expected === null);
        for (const batch of chunks(updates, BATCH_ROWS)) {
          const done = await this.updateRows(tx, c, batch);
          for (const u of batch) {
            const v = done.get(u.id);
            if (v === undefined) conflicts.push({ collection: c.collection, id: u.id });
            else note(c.collection, u.id, v);
          }
        }
        for (const batch of chunks(inserts, BATCH_ROWS)) {
          const done = await this.insertRows(tx, c, batch);
          for (const u of batch) {
            const v = done.get(u.id);
            if (v === undefined) conflicts.push({ collection: c.collection, id: u.id });
            else note(c.collection, u.id, v);
          }
        }
      }
      await this.writeSequencesAndMeta(tx, changes, conflicts, note);
      if (conflicts.length) throw new StoreConflictError(conflicts);
      // A backfill starts a new epoch instead: every server reloads, so row-by-row entries would only be noise.
      if (!options.replaceAll) await this.appendChangeLog(tx, written);
      await this.maybePrune(tx);
      return written;
    });
    this.commit(changes, versions);
    return { written: changes.rowCount };
  }

  private async deleteRows(tx: SqlExecutor, c: CollectionChanges, rows: Array<{ id: string; expected: number }>, force: boolean): Promise<Set<string>> {
    const ids = rows.map((r) => r.id);
    const expected = rows.map((r) => r.expected);
    const where = force ? "" : " AND t.version = u.version";
    const result = c.core
      ? await tx.query<{ id: string }>(
          `DELETE FROM ${qualified(c.core.table)} t USING unnest($1::text[], $2::bigint[]) AS u(id, version) WHERE t.id = u.id${where} RETURNING t.id`,
          [ids, expected]
        )
      : await tx.query<{ id: string }>(
          `DELETE FROM commerceos.documents t USING unnest($1::text[], $2::bigint[]) AS u(id, version)
            WHERE t.collection = $3 AND t.id = u.id${where} RETURNING t.id`,
          [ids, expected, c.collection]
        );
    return new Set(result.rows.map((r) => r.id));
  }

  /** Existing rows: only where the version is unchanged and the row stays with its tenant (review L5). */
  private async updateRows(tx: SqlExecutor, c: CollectionChanges, rows: PendingRow[]): Promise<Map<string, number>> {
    const params = [rows.map((r) => r.id), rows.map((r) => r.expected), rows.map((r) => r.tenantId), rows.map((r) => r.createdAt), rows.map((r) => r.json)];
    const result = c.core
      ? await tx.query<{ id: string; version: string }>(
          `UPDATE ${qualified(c.core.table)} t
              SET data = u.data, created_at = u.created_at, version = t.version + 1, row_updated_at = now()
             FROM unnest($1::text[], $2::bigint[], $3::text[], $4::timestamptz[], $5::jsonb[]) AS u(id, version, tenant_id, created_at, data)
            WHERE t.id = u.id AND t.version = u.version AND t.tenant_id IS NOT DISTINCT FROM u.tenant_id
        RETURNING t.id, t.version::text AS version`,
          params
        )
      : await tx.query<{ id: string; version: string }>(
          `UPDATE commerceos.documents t
              SET data = u.data, created_at = u.created_at, version = t.version + 1, row_updated_at = now()
             FROM unnest($1::text[], $2::bigint[], $3::text[], $4::timestamptz[], $5::jsonb[]) AS u(id, version, tenant_id, created_at, data)
            WHERE t.collection = $6 AND t.id = u.id AND t.version = u.version AND t.tenant_id IS NOT DISTINCT FROM u.tenant_id
        RETURNING t.id, t.version::text AS version`,
          [...params, c.collection]
        );
    return new Map(result.rows.map((r) => [r.id, Number(r.version)]));
  }

  /** New rows: a row another server created with the same id meanwhile is a conflict, not an overwrite. */
  private async insertRows(tx: SqlExecutor, c: CollectionChanges, rows: PendingRow[]): Promise<Map<string, number>> {
    const params = [rows.map((r) => r.id), rows.map((r) => r.tenantId), rows.map((r) => r.createdAt), rows.map((r) => r.json)];
    const result = c.core
      ? await tx.query<{ id: string; version: string }>(
          `INSERT INTO ${qualified(c.core.table)} (id, tenant_id, created_at, data)
           SELECT u.id, u.tenant_id, u.created_at, u.data
             FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[]) WITH ORDINALITY AS u(id, tenant_id, created_at, data, ord)
            ORDER BY u.ord
           ON CONFLICT (id) DO NOTHING
           RETURNING id, version::text AS version`,
          params
        )
      : await tx.query<{ id: string; version: string }>(
          `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data)
           SELECT $5, u.id, u.tenant_id, u.created_at, u.data
             FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[]) WITH ORDINALITY AS u(id, tenant_id, created_at, data, ord)
            ORDER BY u.ord
           ON CONFLICT (collection, id) DO NOTHING
           RETURNING id, version::text AS version`,
          [...params, c.collection]
        );
    return new Map(result.rows.map((r) => [r.id, Number(r.version)]));
  }

  private async writeSequencesAndMeta(
    tx: SqlExecutor,
    changes: ChangeSet,
    conflicts: Array<{ collection: string; id: string }>,
    note: (collection: string, id: string, version: number) => void
  ): Promise<void> {
    for (const s of changes.sequences.deletes) {
      const r = await tx.query("DELETE FROM commerceos.order_sequences WHERE tenant_id = $1 AND version = $2", [s.tenantId, s.expected]);
      if (r.rowCount === 1) note(ORDER_SEQUENCES_KEY, s.tenantId, 0);
      else conflicts.push({ collection: ORDER_SEQUENCES_KEY, id: s.tenantId });
    }
    for (const s of changes.sequences.upserts) {
      const r =
        s.expected === null
          ? await tx.query<{ version: string }>(
              "INSERT INTO commerceos.order_sequences (tenant_id, value) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING RETURNING version::text AS version",
              [s.tenantId, s.value]
            )
          : await tx.query<{ version: string }>(
              `UPDATE commerceos.order_sequences SET value = $2, version = version + 1, row_updated_at = now()
                WHERE tenant_id = $1 AND version = $3 RETURNING version::text AS version`,
              [s.tenantId, s.value, s.expected]
            );
      if (r.rows[0]) note(ORDER_SEQUENCES_KEY, s.tenantId, Number(r.rows[0].version));
      else conflicts.push({ collection: ORDER_SEQUENCES_KEY, id: s.tenantId });
    }
    for (const m of changes.meta.deletes) {
      const r = await tx.query("DELETE FROM commerceos.store_meta WHERE key = $1 AND version = $2", [m.key, m.expected]);
      if (r.rowCount === 1) note("store_meta", m.key, 0);
      else conflicts.push({ collection: "store_meta", id: m.key });
    }
    for (const m of changes.meta.upserts) {
      const r =
        m.expected === null
          ? await tx.query<{ version: string }>(
              "INSERT INTO commerceos.store_meta (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING RETURNING version::text AS version",
              [m.key, m.json]
            )
          : await tx.query<{ version: string }>(
              `UPDATE commerceos.store_meta SET value = $2::jsonb, version = version + 1, row_updated_at = now()
                WHERE key = $1 AND version = $3 RETURNING version::text AS version`,
              [m.key, m.json, m.expected]
            );
      if (r.rows[0]) note("store_meta", m.key, Number(r.rows[0].version));
      else conflicts.push({ collection: "store_meta", id: m.key });
    }
  }

  /**
   * One change-log entry per written row. The advisory lock makes change-log positions follow commit order across
   * servers, so a server reading the log can never skip an entry that commits after one it has already read.
   */
  private async appendChangeLog(tx: SqlExecutor, written: Map<string, Map<string, number>>): Promise<void> {
    const collections: string[] = [];
    const ids: string[] = [];
    const ops: string[] = [];
    for (const [collection, rows] of written) {
      for (const [id, version] of rows) {
        collections.push(collection);
        ids.push(id);
        ops.push(version === 0 ? "delete" : "upsert");
      }
    }
    if (!ids.length) return;
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('commerceos_changes'))");
    for (let i = 0; i < ids.length; i += 5_000) {
      await tx.query(
        "INSERT INTO commerceos.changes (writer, collection, id, op) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[])",
        [this.writerId, collections.slice(i, i + 5_000), ids.slice(i, i + 5_000), ops.slice(i, i + 5_000)]
      );
    }
  }

  private async maybePrune(tx: SqlExecutor): Promise<void> {
    if (Date.now() - this.lastPruneAt < PRUNE_EVERY_MS) return;
    this.lastPruneAt = Date.now();
    const r = await tx.query<{ seq: string | null }>(
      `WITH gone AS (DELETE FROM commerceos.changes WHERE at < now() - interval '${CHANGE_LOG_RETENTION}' RETURNING seq)
       SELECT max(seq)::text AS seq FROM gone`
    );
    const through = r.rows[0]?.seq;
    if (through) await tx.query("UPDATE commerceos.store_state SET pruned_through = greatest(pruned_through, $1) WHERE id = 1", [Number(through)]);
  }

  /** After COMMIT: the written rows (with their new versions) become the baseline. */
  private commit(changes: ChangeSet, versions: Map<string, Map<string, number>>): void {
    for (const c of changes.collections) {
      const committed = this.committed.get(c.collection) ?? new Map<string, Committed>();
      const v = versions.get(c.collection);
      for (const row of c.upserts) committed.set(row.id, { json: row.json, version: v?.get(row.id) ?? 1 });
      for (const d of c.deletes) committed.delete(d.id);
      this.committed.set(c.collection, committed);
    }
    const sv = versions.get(ORDER_SEQUENCES_KEY);
    for (const s of changes.sequences.upserts) this.committedSequences.set(s.tenantId, { value: s.value, version: sv?.get(s.tenantId) ?? 1 });
    for (const s of changes.sequences.deletes) this.committedSequences.delete(s.tenantId);
    const mv = versions.get("store_meta");
    for (const m of changes.meta.upserts) this.committedMeta.set(m.key, { json: m.json, version: mv?.get(m.key) ?? 1 });
    for (const m of changes.meta.deletes) this.committedMeta.delete(m.key);
  }

  // ---- Rollback ----------------------------------------------------------------------------------------------------

  /**
   * Puts memory back to the last committed version of every row in the change set: changed rows get their committed
   * record back, new rows are removed, removed rows return. Needs no database, so it works while Postgres is down.
   */
  restore(data: Record<string, unknown>, changes: ChangeSet): void {
    for (const c of changes.collections) {
      const list = data[c.collection];
      if (!Array.isArray(list)) continue;
      const committed = this.committed.get(c.collection);
      for (const row of c.upserts) {
        const index = list.findIndex((r) => isRecord(r) && recordId(c.collection, r) === row.id);
        const known = committed?.get(row.id);
        if (known) {
          if (index >= 0) list[index] = JSON.parse(known.json);
        } else if (index >= 0) {
          list.splice(index, 1);
        }
      }
      for (const d of c.deletes) {
        const known = committed?.get(d.id);
        if (!known) continue;
        const record: unknown = JSON.parse(known.json);
        if (NEWEST_FIRST_COLLECTIONS.has(c.collection)) list.unshift(record);
        else list.push(record);
      }
    }
    const sequences = data[ORDER_SEQUENCES_KEY];
    if (isRecord(sequences)) {
      for (const s of changes.sequences.upserts) {
        const known = this.committedSequences.get(s.tenantId);
        if (known) sequences[s.tenantId] = known.value;
        else delete sequences[s.tenantId];
      }
      for (const s of changes.sequences.deletes) {
        const known = this.committedSequences.get(s.tenantId);
        if (known) sequences[s.tenantId] = known.value;
      }
    }
    for (const m of [...changes.meta.upserts, ...changes.meta.deletes]) {
      const known = this.committedMeta.get(m.key);
      if (known) data[m.key] = JSON.parse(known.json);
      else delete data[m.key];
    }
  }

  // ---- Sync --------------------------------------------------------------------------------------------------------

  /**
   * The rows other servers changed since this server's last position, as they are now. The baseline is updated to
   * match; the caller applies the rows to memory (applySync).
   */
  async sync(): Promise<SyncResult> {
    const state = await this.client.query<{ epoch: string; pruned_through: string; max_seq: string }>(
      `SELECT s.epoch, s.pruned_through::text AS pruned_through,
              (SELECT coalesce(max(seq), 0) FROM commerceos.changes)::text AS max_seq
         FROM commerceos.store_state s WHERE s.id = 1`
    );
    const row = state.rows[0];
    if (!row) return { reload: true, rows: [] };
    if (row.epoch !== this.epoch || Number(row.pruned_through) > this.lastSeq) return { reload: true, rows: [] };
    const maxSeq = Number(row.max_seq);
    if (maxSeq <= this.lastSeq) return { reload: false, rows: [] };
    const entries = await this.client.query<{ collection: string; id: string }>(
      `SELECT DISTINCT collection, id FROM commerceos.changes
        WHERE seq > $1 AND seq <= $2 AND writer <> $3
        LIMIT ${SYNC_MAX_ROWS + 1}`,
      [this.lastSeq, maxSeq, this.writerId]
    );
    if (entries.rows.length > SYNC_MAX_ROWS) return { reload: true, rows: [] };
    const byCollection = new Map<string, string[]>();
    for (const e of entries.rows) {
      const list = byCollection.get(e.collection) ?? [];
      list.push(e.id);
      byCollection.set(e.collection, list);
    }
    const rows: SyncedRow[] = [];
    for (const [collection, ids] of byCollection) {
      if (collection === ORDER_SEQUENCES_KEY) {
        const r = await this.client.query<{ tenant_id: string; value: string; version: string }>(
          "SELECT tenant_id, value::text AS value, version::text AS version FROM commerceos.order_sequences WHERE tenant_id = ANY($1::text[])",
          [ids]
        );
        const found = new Map(r.rows.map((x) => [x.tenant_id, x]));
        for (const id of ids) {
          const x = found.get(id);
          if (x) this.committedSequences.set(id, { value: Number(x.value), version: Number(x.version) });
          else this.committedSequences.delete(id);
          rows.push({ collection, id, record: x ? Number(x.value) : null });
        }
        continue;
      }
      if (collection === "store_meta") {
        const r = await this.client.query<{ key: string; value: string; version: string }>(
          "SELECT key, value::text AS value, version::text AS version FROM commerceos.store_meta WHERE key = ANY($1::text[])",
          [ids]
        );
        const found = new Map(r.rows.map((x) => [x.key, x]));
        for (const id of ids) {
          const x = found.get(id);
          const value: unknown = x ? JSON.parse(x.value) : null;
          if (x) this.committedMeta.set(id, { json: JSON.stringify(value), version: Number(x.version) });
          else this.committedMeta.delete(id);
          rows.push({ collection: "store_meta", id, record: value });
        }
        continue;
      }
      const core = coreTableFor(collection);
      const r = core
        ? await this.client.query<{ id: string; version: string; data: string }>(
            `SELECT id, version::text AS version, data::text AS data FROM ${qualified(core.table)} WHERE id = ANY($1::text[])`,
            [ids]
          )
        : await this.client.query<{ id: string; version: string; data: string }>(
            "SELECT id, version::text AS version, data::text AS data FROM commerceos.documents WHERE collection = $1 AND id = ANY($2::text[])",
            [collection, ids]
          );
      const found = new Map(r.rows.map((x) => [x.id, x]));
      const committed = this.committed.get(collection) ?? new Map<string, Committed>();
      for (const id of ids) {
        const x = found.get(id);
        if (!x) {
          committed.delete(id);
          rows.push({ collection, id, record: null });
          continue;
        }
        const known = committed.get(id);
        if (known && known.version >= Number(x.version)) continue; // already current
        const record: unknown = JSON.parse(x.data);
        committed.set(id, { json: JSON.stringify(record), version: Number(x.version) });
        rows.push({ collection, id, record });
      }
      this.committed.set(collection, committed);
    }
    this.lastSeq = maxSeq;
    return { reload: false, rows };
  }

  /** Applies synced rows to memory: replaced in place, removed, or added (at the end; at the front when newest-first). */
  applySync(data: Record<string, unknown>, rows: SyncedRow[]): void {
    for (const r of rows) {
      if (r.collection === ORDER_SEQUENCES_KEY) {
        const sequences = (data[ORDER_SEQUENCES_KEY] ??= {}) as Record<string, number>;
        if (typeof r.record === "number") sequences[r.id] = r.record;
        else delete sequences[r.id];
        continue;
      }
      if (r.collection === "store_meta") {
        if (r.record === null) delete data[r.id];
        else data[r.id] = r.record;
        continue;
      }
      const list = (Array.isArray(data[r.collection]) ? data[r.collection] : (data[r.collection] = [])) as unknown[];
      const index = list.findIndex((x) => isRecord(x) && recordId(r.collection, x) === r.id);
      if (r.record === null) {
        if (index >= 0) list.splice(index, 1);
      } else if (index >= 0) {
        list[index] = r.record;
      } else if (NEWEST_FIRST_COLLECTIONS.has(r.collection)) {
        list.unshift(r.record);
      } else {
        list.push(r.record);
      }
    }
  }

  /**
   * Diagnostics for a refused backfill: inserts the change set row by row, parents first, with every constraint
   * checked immediately, and lists the rows the database refuses. Always rolled back; writes nothing.
   */
  async findRejectedRows(changes: ChangeSet): Promise<RejectedRow[]> {
    const refused: RejectedRow[] = [];
    const rollback = new Error("diagnostic rollback");
    try {
      await this.client.transaction(async (tx) => {
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
        for (const c of changes.collections) {
          for (const row of c.upserts) {
            await tx.query("SAVEPOINT diag_row");
            try {
              const done = await this.insertRows(tx, c, [row]);
              if (!done.has(row.id)) throw Object.assign(new Error("exists"), { code: "23505", constraint: "primary key" });
              await tx.query("RELEASE SAVEPOINT diag_row");
            } catch (err) {
              await tx.query("ROLLBACK TO SAVEPOINT diag_row");
              const e = err as { code?: unknown; constraint?: unknown };
              refused.push({
                collection: c.collection,
                id: row.id,
                op: "upsert",
                reason: typeof e.code === "string" ? e.code : "REJECTED",
                constraint: typeof e.constraint === "string" ? e.constraint : undefined,
              });
            }
          }
        }
        throw rollback;
      });
    } catch (err) {
      if (err !== rollback) throw err;
    }
    return refused;
  }

  // ---- Reporting ---------------------------------------------------------------------------------------------------

  /** Records that can't be stored at all (no usable id, a repeated id), from the last full comparison. */
  unsavedRows(): RejectedRow[] {
    return this.lastUnwritable;
  }

  async ping(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      return await Promise.race([this.client.query("SELECT 1").then(() => true), timeout]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Logs, once per distinct value, how many records couldn't be stored or were cleaned. */
export function logUnwritable(unwritable: RejectedRow[], sanitized: number, last: { unwritable: number; sanitized: number }): void {
  if (unwritable.length !== last.unwritable) {
    last.unwritable = unwritable.length;
    if (unwritable.length) {
      logger.error("db.pg_rows_unwritable", {
        count: unwritable.length,
        sample: unwritable.slice(0, 10).map((r) => ({ collection: r.collection, id: r.id, reason: r.reason })),
      });
    }
  }
  if (sanitized !== last.sanitized) {
    last.sanitized = sanitized;
    if (sanitized) logger.warn("db.pg_rows_sanitized", { count: sanitized });
  }
}
