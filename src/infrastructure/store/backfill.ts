/**
 * Backfill and verification (FIX_IMPLEMENTATION_PLAN FX-43, ADR-108). Used by scripts/migrate-json-to-pg.ts,
 * scripts/verify-migration.ts and the Phase 4 tests.
 *
 * The backfill uses the store's own writer (the same serialization, keys and tables as the running app), refuses while
 * an app is writing to the target, and loads everything in ONE transaction: a failure leaves the target exactly as it
 * was. A new store epoch makes any server still attached reload (ADR-109).
 */
import { countRecords, diffStores, type CollectionDiff } from "./canonical";
import { PgStorePersistence, type RejectedRow } from "./pg-store";
import { isDataRejected, type SqlClient } from "./sql-client";
import { CORE_TABLES, coreTableFor, qualified, recordId, type CoreTable } from "./store-schema";

export interface BackfillResult {
  rows: number;
  collections: number;
  /** Records that can't be stored (no id, repeated id): never sent. */
  unwritable: RejectedRow[];
  /** Records whose text Postgres can't hold (NUL, half an emoji) and that were cleaned; verification compares cleaned text. */
  sanitized: number;
  report: { mode: "batch" | "row-by-row"; written: number; rejected: RejectedRow[] };
  ms: number;
}

/** An app wrote to the target this recently: the backfill refuses (it would replace the app's writes). */
const ACTIVE_APP_WINDOW_SECONDS = 60;

async function targetRowCount(client: SqlClient): Promise<number> {
  let total = 0;
  for (const core of Object.values(CORE_TABLES) as CoreTable[]) {
    const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${qualified(core.table)}`);
    total += Number(r.rows[0]?.n ?? 0);
  }
  const docs = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM commerceos.documents");
  return total + Number(docs.rows[0]?.n ?? 0);
}

/**
 * Copies a whole store into Postgres. `replace` empties the target first; otherwise a non-empty target is refused.
 * `onRejected: "row-by-row"` (rehearsal) lists every row the database refuses instead of stopping at the first; nothing
 * is written then.
 */
export async function backfillStore(
  source: Record<string, unknown>,
  target: SqlClient,
  options: { replace: boolean; onRejected: "throw" | "row-by-row" }
): Promise<BackfillResult> {
  const started = Date.now();
  const pg = new PgStorePersistence(target);
  if (!(await pg.schemaPresent())) throw new Error("The target has no commerceos schema: run `npm run db:migrate` first.");
  const active = await pg.recentForeignWrites(ACTIVE_APP_WINDOW_SECONDS);
  if (active > 0) {
    throw new Error(`An app wrote ${active} change(s) to the target in the last ${ACTIVE_APP_WINDOW_SECONDS} s. Stop every app server first.`);
  }
  if (!options.replace) {
    const existing = await targetRowCount(target);
    if (existing > 0) throw new Error(`The target already holds ${existing} rows. Re-run with --replace to overwrite them.`);
  }
  const changes = pg.computeChanges(source);
  const { rows, collections } = countRecords(source);
  const base = { rows, collections, unwritable: changes.unwritable, sanitized: changes.sanitizedRows };
  try {
    const { written } = await pg.write(changes, { replaceAll: true });
    return { ...base, report: { mode: "batch", written, rejected: [] }, ms: Date.now() - started };
  } catch (err) {
    if (options.onRejected === "throw" || !isDataRejected(err)) throw err;
    const rejected = await pg.findRejectedRows(changes);
    return { ...base, report: { mode: "row-by-row", written: 0, rejected }, ms: Date.now() - started };
  }
}

export interface VerifyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface VerifyReport {
  pass: boolean;
  checks: VerifyCheck[];
  diffs: CollectionDiff[];
}

function perTenantCounts(list: unknown[], collection: string): Map<string, number> {
  const out = new Map<string, number>();
  const core = coreTableFor(collection);
  const seen = new Set<string>();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = recordId(collection, record);
    if (id === null || seen.has(id)) continue; // not storable: reported by the backfill, not counted here
    seen.add(id);
    const tenant = core?.tenant === "self" ? id : typeof record.tenant_id === "string" && record.tenant_id ? record.tenant_id : "";
    out.set(tenant, (out.get(tenant) ?? 0) + 1);
  }
  return out;
}

function sumBy(list: unknown[], field: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of list) {
    const r = row as Record<string, unknown>;
    const tenant = typeof r.tenant_id === "string" ? r.tenant_id : "";
    const n = Number(r[field]);
    if (Number.isFinite(n)) out.set(tenant, (out.get(tenant) ?? 0) + n);
  }
  return out;
}

function sameNumbers(a: Map<string, number>, b: Map<string, number>, epsilon = 0): string[] {
  const bad: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? 0;
    const y = b.get(key) ?? 0;
    if (Math.abs(x - y) > epsilon) bad.push(`${key || "(none)"}: expected ${x}, found ${y}`);
  }
  return bad;
}

/**
 * Compares a source store with what Postgres holds (FX-43 step 2): per-tenant row counts for every collection, order
 * totals and on-hand stock summed in SQL, order sequences, and every record deep-equal (not a sample).
 */
export async function verifyStore(source: Record<string, unknown>, target: SqlClient): Promise<VerifyReport> {
  const checks: VerifyCheck[] = [];
  const loaded = await new PgStorePersistence(target).load();

  // Per-tenant row counts, counted in SQL.
  const countMismatches: string[] = [];
  for (const [collection, value] of Object.entries(source)) {
    if (!Array.isArray(value)) continue;
    const expected = perTenantCounts(value, collection);
    const core = coreTableFor(collection);
    const r = core
      ? await target.query<{ tenant_id: string | null; n: string }>(
          `SELECT tenant_id, count(*)::text AS n FROM ${qualified(core.table)} GROUP BY tenant_id`
        )
      : await target.query<{ tenant_id: string | null; n: string }>(
          "SELECT tenant_id, count(*)::text AS n FROM commerceos.documents WHERE collection = $1 GROUP BY tenant_id",
          [collection]
        );
    const actual = new Map(r.rows.map((row) => [row.tenant_id ?? "", Number(row.n)]));
    for (const bad of sameNumbers(expected, actual)) countMismatches.push(`${collection} ${bad}`);
  }
  checks.push({
    name: "row counts per tenant and collection",
    pass: countMismatches.length === 0,
    detail: countMismatches.length ? countMismatches.slice(0, 10).join("; ") : "all equal",
  });

  // Money and stock, summed by Postgres from the generated columns.
  const orderSums = await target.query<{ tenant_id: string; s: string }>(
    "SELECT tenant_id, coalesce(sum(grand_total), 0)::text AS s FROM commerceos.orders GROUP BY tenant_id"
  );
  const orderBad = sameNumbers(
    sumBy((source.orders as unknown[]) ?? [], "grand_total"),
    new Map(orderSums.rows.map((r) => [r.tenant_id, Number(r.s)])),
    0.005
  );
  checks.push({ name: "SUM(grand_total) of orders per tenant", pass: orderBad.length === 0, detail: orderBad.join("; ") || "equal" });

  const stockSums = await target.query<{ tenant_id: string; s: string }>(
    "SELECT tenant_id, coalesce(sum(quantity_on_hand), 0)::text AS s FROM commerceos.inventory_items GROUP BY tenant_id"
  );
  const stockBad = sameNumbers(
    sumBy((source.inventory_items as unknown[]) ?? [], "quantity_on_hand"),
    new Map(stockSums.rows.map((r) => [r.tenant_id, Number(r.s)]))
  );
  checks.push({ name: "SUM(quantity_on_hand) of inventory per tenant", pass: stockBad.length === 0, detail: stockBad.join("; ") || "equal" });

  const seqExpected = new Map(Object.entries((source.order_sequences as Record<string, number>) ?? {}).map(([k, v]) => [k, Number(v)]));
  const seqActual = new Map(Object.entries((loaded.order_sequences as Record<string, number>) ?? {}).map(([k, v]) => [k, Number(v)]));
  const seqBad = sameNumbers(seqExpected, seqActual);
  checks.push({ name: "order number sequences", pass: seqBad.length === 0, detail: seqBad.join("; ") || "equal" });

  const diffs = diffStores(source, loaded);
  const { rows } = countRecords(source);
  checks.push({
    name: "every record deep-equal",
    pass: diffs.length === 0,
    detail: diffs.length ? `${diffs.length} collections differ` : `${rows} records compared`,
  });

  return { pass: checks.every((c) => c.pass), checks, diffs };
}
