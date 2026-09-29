/**
 * Postgres persistence for the store (FIX_IMPLEMENTATION_PLAN FX-42/FX-44, ADR-108).
 *
 * The store keeps its synchronous API and its in-memory working set; Postgres is the system of record behind it:
 *   - load():            reads every table into memory at start-up (the JSON file is no longer read);
 *   - computeChanges():  compares every record with what was last committed and collects the changed and removed rows
 *                        (no service has to report what it touched, so direct `db.data` edits are saved too);
 *   - write():           writes those rows in ONE transaction, after checking this process still holds the writer lease.
 *
 * If the database refuses the batch (a constraint or a malformed value), the batch is retried row by row with every
 * constraint checked immediately: rows the database refuses are set aside and reported (health turns not-ready), and
 * everything else is saved. One bad record never stops every other write.
 *
 * Single replica: exactly one process may write (the lease in commerceos.store_writer replaces the lock file of FX-24).
 * Multiple replicas need the async, SQL-first services of the next round (FX-45).
 */
import crypto from "crypto";
import os from "os";
import { logger } from "@/lib/logger";
import { isDataRejected, pgErrorFields, type SqlClient, type SqlExecutor } from "./sql-client";
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

/** A writer that stops renewing its lease for this long can be replaced by another process. */
export const LEASE_TTL_MS = Math.max(5_000, Number(process.env.STORE_LEASE_TTL_MS ?? 30_000));
const BATCH_ROWS = 500;

export interface LeaseHolder {
  owner: string;
  host: string;
  pid: number;
  started_at: string;
  heartbeat_at: string;
}

export class LeaseLostError extends Error {
  readonly code = "LEASE_LOST";
}

interface PendingRow {
  id: string;
  tenantId: string | null;
  createdAt: string | null;
  json: string;
}

interface CollectionChanges {
  collection: string;
  core: CoreTable | undefined;
  upserts: PendingRow[];
  deletes: string[];
}

export interface RejectedRow {
  collection: string;
  id: string;
  op: "upsert" | "delete";
  /** MISSING_ID / DUPLICATE_ID / NOT_SERIALIZABLE (never sent), or the SQLSTATE the database answered. */
  reason: string;
  constraint?: string;
}

export interface ChangeSet {
  collections: CollectionChanges[];
  sequences: { upserts: Array<[string, number]>; deletes: string[] };
  meta: { upserts: Array<[string, string]>; deletes: string[] };
  /** Records that can't be stored at all (no id, a repeated id): reported, never sent. */
  unwritable: RejectedRow[];
  rowCount: number;
  sanitizedRows: number;
}

export interface WriteReport {
  mode: "batch" | "row-by-row";
  written: number;
  rejected: RejectedRow[];
}

const NEEDS_CLEANING =/\\u0000|\\ud[89a-f]/i;
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

const rowKey = (collection: string, id: string) => `${collection}\u0000${id}`;

export class PgStorePersistence {
  readonly ownerId = crypto.randomUUID();
  private readonly host = os.hostname();
  /** What Postgres holds, as last committed by this process: collection → id → record JSON. */
  private readonly committed = new Map<string, Map<string, string>>();
  private readonly committedSequences = new Map<string, number>();
  private readonly committedMeta = new Map<string, string>();
  /** Rows the database refused, with the exact JSON refused: retried only once the record changes. */
  private readonly rejected = new Map<string, { json: string; row: RejectedRow }>();
  private lastUnwritable: RejectedRow[] = [];

  constructor(readonly client: SqlClient) {}

  // ---- Schema and lease --------------------------------------------------------------------------------------------

  async schemaPresent(): Promise<boolean> {
    const result = await this.client.query<{ present: boolean }>(
      "SELECT to_regclass('commerceos.store_writer') IS NOT NULL AND to_regclass('commerceos.documents') IS NOT NULL AS present"
    );
    return result.rows[0]?.present === true;
  }

  async acquireLease(): Promise<{ acquired: true } | { acquired: false; holder: LeaseHolder | null }> {
    const result = await this.client.query<{ owner: string }>(
      `INSERT INTO commerceos.store_writer AS w (id, owner, host, pid) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, host = EXCLUDED.host, pid = EXCLUDED.pid,
                                      started_at = now(), heartbeat_at = now()
       WHERE w.owner = EXCLUDED.owner OR w.heartbeat_at < now() - ($4::double precision * interval '1 millisecond')
       RETURNING owner`,
      [this.ownerId, this.host, process.pid, LEASE_TTL_MS]
    );
    if (result.rows.length > 0) return { acquired: true };
    return { acquired: false, holder: await this.readLease() };
  }

  async readLease(): Promise<LeaseHolder | null> {
    const result = await this.client.query<LeaseHolder>(
      "SELECT owner, host, pid, started_at::text AS started_at, heartbeat_at::text AS heartbeat_at FROM commerceos.store_writer WHERE id = 1"
    );
    return result.rows[0] ?? null;
  }

  /** False when another process has taken the lease over (this one must stop writing). */
  async renewLease(): Promise<boolean> {
    const result = await this.client.query("UPDATE commerceos.store_writer SET heartbeat_at = now() WHERE id = 1 AND owner = $1", [this.ownerId]);
    return result.rowCount === 1;
  }

  async releaseLease(): Promise<void> {
    await this.client.query("DELETE FROM commerceos.store_writer WHERE id = 1 AND owner = $1", [this.ownerId]);
  }

  /** Fencing: every write transaction locks the lease row and checks it still names this process. */
  private async fence(tx: SqlExecutor): Promise<void> {
    const result = await tx.query<{ owner: string }>("SELECT owner FROM commerceos.store_writer WHERE id = 1 FOR UPDATE");
    if (result.rows[0]?.owner !== this.ownerId) {
      throw new LeaseLostError("The store writer lease belongs to another process; nothing was written.");
    }
    await tx.query("UPDATE commerceos.store_writer SET heartbeat_at = now() WHERE id = 1");
  }

  // ---- Load --------------------------------------------------------------------------------------------------------

  /** Reads the whole store. The returned records become the baseline that computeChanges() compares against. */
  async load(): Promise<Record<string, unknown>> {
    this.committed.clear();
    this.committedSequences.clear();
    this.committedMeta.clear();
    this.rejected.clear();
    const out: Record<string, unknown> = {};
    for (const [collection, core] of Object.entries(CORE_TABLES) as Array<[string, CoreTable]>) {
      const order = NEWEST_FIRST_COLLECTIONS.has(collection) ? "DESC" : "ASC";
      const result = await this.client.query<{ id: string; data: string }>(
        `SELECT id, data::text AS data FROM ${qualified(core.table)} ORDER BY seq ${order}`
      );
      out[collection] = this.adopt(collection, result.rows);
    }
    const docs = await this.client.query<{ collection: string; id: string; data: string }>(
      "SELECT collection, id, data::text AS data FROM commerceos.documents ORDER BY collection, seq"
    );
    const grouped = new Map<string, Array<{ id: string; data: string }>>();
    for (const row of docs.rows) {
      const list = grouped.get(row.collection) ?? [];
      list.push(row);
      grouped.set(row.collection, list);
    }
    for (const [collection, rows] of grouped) {
      if (NEWEST_FIRST_COLLECTIONS.has(collection)) rows.reverse();
      out[collection] = this.adopt(collection, rows);
    }
    const sequences = await this.client.query<{ tenant_id: string; value: string }>(
      "SELECT tenant_id, value::text AS value FROM commerceos.order_sequences"
    );
    const seqObject: Record<string, number> = {};
    for (const row of sequences.rows) {
      seqObject[row.tenant_id] = Number(row.value);
      this.committedSequences.set(row.tenant_id, Number(row.value));
    }
    out[ORDER_SEQUENCES_KEY] = seqObject;
    const meta = await this.client.query<{ key: string; value: string }>("SELECT key, value::text AS value FROM commerceos.store_meta");
    for (const row of meta.rows) {
      const value: unknown = JSON.parse(row.value);
      out[row.key] = value;
      this.committedMeta.set(row.key, JSON.stringify(value));
    }
    return out;
  }

  private adopt(collection: string, rows: Array<{ id: string; data: string }>): unknown[] {
    const committed = new Map<string, string>();
    const list: unknown[] = [];
    for (const row of rows) {
      const record: unknown = JSON.parse(row.data);
      committed.set(row.id, JSON.stringify(record));
      list.push(record);
    }
    this.committed.set(collection, committed);
    return list;
  }

  // ---- Change detection --------------------------------------------------------------------------------------------

  /**
   * Every record whose JSON differs from what was last committed, and every committed record that is gone. A
   * collection missing from `data` altogether is left untouched in Postgres (never read as "delete everything").
   */
  computeChanges(data: Record<string, unknown>): ChangeSet {
    const changes: ChangeSet = {
      collections: [],
      sequences: { upserts: [], deletes: [] },
      meta: { upserts: [], deletes: [] },
      unwritable: [],
      rowCount: 0,
      sanitizedRows: 0,
    };
    const coreOrder = Object.keys(CORE_TABLES).filter((k) => k in data);
    const others = Object.keys(data)
      .filter((k) => !coreTableFor(k))
      .sort();
    for (const collection of [...coreOrder, ...others]) {
      const value = data[collection];
      if (Array.isArray(value)) this.diffCollection(collection, value, changes);
      else if (collection === ORDER_SEQUENCES_KEY && isRecord(value)) this.diffSequences(value, changes);
      else if (value !== undefined) this.diffMeta(collection, value, changes);
    }
    this.lastUnwritable = changes.unwritable;
    changes.rowCount =
      changes.collections.reduce((n, c) => n + c.upserts.length + c.deletes.length, 0) +
      changes.sequences.upserts.length +
      changes.sequences.deletes.length +
      changes.meta.upserts.length +
      changes.meta.deletes.length;
    return changes;
  }

  private diffCollection(collection: string, list: unknown[], changes: ChangeSet): void {
    const committed = this.committed.get(collection) ?? new Map<string, string>();
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
      if (committed.get(id) === serialized.json) continue;
      const refused = this.rejected.get(rowKey(collection, id));
      if (refused && refused.row.op === "upsert" && refused.json === serialized.json) continue;
      out.upserts.push({ id, tenantId: tenantOf(core, row, id), createdAt: rowTime(row), json: serialized.json });
    }
    for (const id of committed.keys()) {
      if (seen.has(id)) continue;
      const refused = this.rejected.get(rowKey(collection, id));
      if (refused && refused.row.op === "delete") continue;
      out.deletes.push(id);
    }
    // A refused record that no longer exists in memory has nothing left to retry.
    for (const [key, entry] of this.rejected) {
      if (entry.row.collection === collection && entry.row.op === "upsert" && !seen.has(entry.row.id)) this.rejected.delete(key);
    }
    if (out.upserts.length || out.deletes.length) changes.collections.push(out);
  }

  private diffSequences(value: Record<string, unknown>, changes: ChangeSet): void {
    const seen = new Set<string>();
    for (const [tenantId, raw] of Object.entries(value)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      seen.add(tenantId);
      if (this.committedSequences.get(tenantId) !== n) changes.sequences.upserts.push([tenantId, n]);
    }
    for (const tenantId of this.committedSequences.keys()) if (!seen.has(tenantId)) changes.sequences.deletes.push(tenantId);
  }

  private diffMeta(key: string, value: unknown, changes: ChangeSet): void {
    let json: string;
    try {
      json = serializeRecord(value).json;
    } catch {
      changes.unwritable.push({ collection: key, id: "", op: "upsert", reason: "NOT_SERIALIZABLE" });
      return;
    }
    if (this.committedMeta.get(key) !== json) changes.meta.upserts.push([key, json]);
  }

  // ---- Write -------------------------------------------------------------------------------------------------------

  /**
   * Writes a change set in one transaction. `replaceAll` empties every store table first (backfill).
   * `onRejected: "row-by-row"` (the running app) retries a refused batch row by row and sets refused rows aside;
   * `"throw"` (backfill) fails the whole write so nothing partial is left behind.
   */
  async write(changes: ChangeSet, options: { replaceAll?: boolean; onRejected?: "row-by-row" | "throw" } = {}): Promise<WriteReport> {
    try {
      await this.client.transaction(async (tx) => {
        await this.fence(tx);
        if (options.replaceAll) await tx.exec(`TRUNCATE ${storeTablesChildrenFirst().map(qualified).join(", ")}`);
        await this.writeBatched(tx, changes);
      });
    } catch (err) {
      if (!isDataRejected(err) || options.onRejected === "throw") throw err;
      const fields = pgErrorFields(err);
      logger.warn("db.pg_batch_rejected", { code: fields.code, constraint: fields.constraint, table: fields.table, rows: changes.rowCount });
      return this.writeRowByRow(changes, options.replaceAll === true);
    }
    this.commit(changes, new Set());
    return { mode: "batch", written: changes.rowCount, rejected: [] };
  }

  private async writeBatched(tx: SqlExecutor, changes: ChangeSet): Promise<void> {
    for (const c of [...changes.collections].reverse()) {
      for (const ids of chunks(c.deletes, BATCH_ROWS)) await this.deleteRows(tx, c, ids);
    }
    for (const c of changes.collections) {
      for (const rows of chunks(c.upserts, BATCH_ROWS)) await this.upsertRows(tx, c, rows);
    }
    await this.writeSequencesAndMeta(tx, changes);
  }

  private async writeRowByRow(changes: ChangeSet, replaceAll: boolean): Promise<WriteReport> {
    const refused = new Map<string, RejectedRow>();
    await this.client.transaction(async (tx) => {
      await this.fence(tx);
      await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      if (replaceAll) await tx.exec(`TRUNCATE ${storeTablesChildrenFirst().map(qualified).join(", ")}`);
      const attempt = async (collection: string, id: string, op: RejectedRow["op"], write: () => Promise<void>) => {
        await tx.query("SAVEPOINT store_row");
        try {
          await write();
          await tx.query("RELEASE SAVEPOINT store_row");
        } catch (err) {
          if (!isDataRejected(err)) throw err;
          await tx.query("ROLLBACK TO SAVEPOINT store_row");
          const fields = pgErrorFields(err);
          refused.set(rowKey(collection, id), { collection, id, op, reason: fields.code ?? "REJECTED", constraint: fields.constraint });
        }
      };
      for (const c of [...changes.collections].reverse()) {
        for (const id of c.deletes) await attempt(c.collection, id, "delete", () => this.deleteRows(tx, c, [id]));
      }
      for (const c of changes.collections) {
        for (const row of c.upserts) await attempt(c.collection, row.id, "upsert", () => this.upsertRows(tx, c, [row]));
      }
      await this.writeSequencesAndMeta(tx, changes);
    });
    this.commit(changes, new Set(refused.keys()));
    for (const c of changes.collections) {
      for (const row of c.upserts) {
        const r = refused.get(rowKey(c.collection, row.id));
        if (r && r.op === "upsert") this.rejected.set(rowKey(c.collection, row.id), { json: row.json, row: r });
      }
      for (const id of c.deletes) {
        const r = refused.get(rowKey(c.collection, id));
        if (r && r.op === "delete") this.rejected.set(rowKey(c.collection, id), { json: "", row: r });
      }
    }
    const rejected = [...refused.values()];
    for (const r of rejected) {
      logger.error("db.pg_row_rejected", { collection: r.collection, id: r.id, op: r.op, code: r.reason, constraint: r.constraint });
    }
    return { mode: "row-by-row", written: changes.rowCount - rejected.length, rejected };
  }

  private async upsertRows(tx: SqlExecutor, c: CollectionChanges, rows: PendingRow[]): Promise<void> {
    const ids = rows.map((r) => r.id);
    const tenants = rows.map((r) => r.tenantId);
    const times = rows.map((r) => r.createdAt);
    const data = rows.map((r) => r.json);
    if (c.core) {
      await tx.query(
        `INSERT INTO ${qualified(c.core.table)} (id, tenant_id, created_at, data)
         SELECT u.id, u.tenant_id, u.created_at, u.data
           FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[]) WITH ORDINALITY AS u(id, tenant_id, created_at, data, ord)
          ORDER BY u.ord
         ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, created_at = EXCLUDED.created_at,
                                        data = EXCLUDED.data, row_updated_at = now()`,
        [ids, tenants, times, data]
      );
      return;
    }
    await tx.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data)
       SELECT $5, u.id, u.tenant_id, u.created_at, u.data
         FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[]) WITH ORDINALITY AS u(id, tenant_id, created_at, data, ord)
        ORDER BY u.ord
       ON CONFLICT (collection, id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, created_at = EXCLUDED.created_at,
                                                  data = EXCLUDED.data, row_updated_at = now()`,
      [ids, tenants, times, data, c.collection]
    );
  }

  private async deleteRows(tx: SqlExecutor, c: CollectionChanges, ids: string[]): Promise<void> {
    if (c.core) {
      await tx.query(`DELETE FROM ${qualified(c.core.table)} WHERE id = ANY($1::text[])`, [ids]);
    } else {
      await tx.query("DELETE FROM commerceos.documents WHERE collection = $1 AND id = ANY($2::text[])", [c.collection, ids]);
    }
  }

  private async writeSequencesAndMeta(tx: SqlExecutor, changes: ChangeSet): Promise<void> {
    const { sequences, meta } = changes;
    if (sequences.deletes.length) {
      await tx.query("DELETE FROM commerceos.order_sequences WHERE tenant_id = ANY($1::text[])", [sequences.deletes]);
    }
    if (sequences.upserts.length) {
      await tx.query(
        `INSERT INTO commerceos.order_sequences (tenant_id, value)
         SELECT * FROM unnest($1::text[], $2::bigint[])
         ON CONFLICT (tenant_id) DO UPDATE SET value = EXCLUDED.value, row_updated_at = now()`,
        [sequences.upserts.map(([t]) => t), sequences.upserts.map(([, v]) => v)]
      );
    }
    if (meta.deletes.length) await tx.query("DELETE FROM commerceos.store_meta WHERE key = ANY($1::text[])", [meta.deletes]);
    if (meta.upserts.length) {
      await tx.query(
        `INSERT INTO commerceos.store_meta (key, value)
         SELECT * FROM unnest($1::text[], $2::jsonb[])
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, row_updated_at = now()`,
        [meta.upserts.map(([k]) => k), meta.upserts.map(([, v]) => v)]
      );
    }
  }

  /** After COMMIT: the written rows become the new baseline; refused rows keep the previous one. */
  private commit(changes: ChangeSet, refused: Set<string>): void {
    for (const c of changes.collections) {
      const committed = this.committed.get(c.collection) ?? new Map<string, string>();
      for (const row of c.upserts) {
        const key = rowKey(c.collection, row.id);
        if (refused.has(key)) continue;
        committed.set(row.id, row.json);
        this.rejected.delete(key);
      }
      for (const id of c.deletes) {
        const key = rowKey(c.collection, id);
        if (refused.has(key)) continue;
        committed.delete(id);
        this.rejected.delete(key);
      }
      this.committed.set(c.collection, committed);
    }
    for (const [tenantId, value] of changes.sequences.upserts) this.committedSequences.set(tenantId, value);
    for (const tenantId of changes.sequences.deletes) this.committedSequences.delete(tenantId);
    for (const [key, json] of changes.meta.upserts) this.committedMeta.set(key, json);
    for (const key of changes.meta.deletes) this.committedMeta.delete(key);
  }

  // ---- Reporting ---------------------------------------------------------------------------------------------------

  /** Records that aren't in Postgres as they are in memory: refused by the database, or impossible to store. */
  unsavedRows(): RejectedRow[] {
    return [...[...this.rejected.values()].map((r) => r.row), ...this.lastUnwritable];
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
