/**
 * One tenant's rows of a store collection, wherever they live: memory when the collection is hydrated, Postgres when
 * zero-hydration leaves it out of memory (Phase D). Tenant-scoped on every path.
 *
 * Two uses:
 * - `readTenantRows` / `readTenantRow`: an awaited read a repository or service uses directly.
 * - `loadTenantRows` / `loadTenantRowsWhere`: put the rows in the current request's working set (CommerceDatabase
 *   `withTenantReads`, opened by withStore), so the store's synchronous methods (getAllOrders, getInventory,
 *   findOrderById, updateOrderStatus, ...) can read and change them under zero-hydration. Changes are saved with the
 *   request's commit, checked against the version each row was loaded with.
 */
import { db, PLATFORM_SCOPE } from "@/infrastructure/db";
import { coreTableFor, qualified } from "@/infrastructure/store/store-schema";

type Row = Record<string, unknown>;

export { PLATFORM_SCOPE };
const PLATFORM_COLLECTIONS = new Set(["csp_reports"]);

/** Rows whose `field` equals one of `values` (compared as text, like `data->>'field'`). */
export interface RowFilter {
  field: string;
  values: readonly string[];
}

const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

/** Text columns migration 006 generates from `data`: filtering on them uses the table's indexes. */
const GENERATED_TEXT_COLUMNS: Record<string, readonly string[]> = {
  audit_logs: ["action", "resource_type", "resource_id"],
  products: ["status", "category_id"],
  product_variants: ["product_id"],
  warehouses: ["code"],
  inventory_items: ["warehouse_id", "product_variant_id"],
  stock_movements: ["product_variant_id", "reference_id"],
  inventory_reservations: ["order_id", "status"],
  customers: ["phone", "status"],
  customer_addresses: ["customer_id"],
  orders: ["order_number", "status", "payment_status", "customer_id"],
  order_items: ["order_id", "variant_id"],
  customer_identities: ["customer_id", "channel_type", "external_user_id"],
};

export function parseRowData<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

function matches(row: Row, filter: RowFilter | undefined): boolean {
  if (!filter) return true;
  const value = row[filter.field];
  return value !== undefined && value !== null && filter.values.includes(String(value));
}

/** The tenant's rows from Postgres with their versions (no memory, no working set). */
async function selectRows(collection: string, tenantId: string, filter?: RowFilter): Promise<Array<{ row: Row; version: number }>> {
  checkFilter(filter);
  // Only platform-scope collections are read without a tenant
  if (tenantId === PLATFORM_SCOPE && !PLATFORM_COLLECTIONS.has(collection)) throw new Error(`'${collection}' is read per tenant.`);
  const client = db.getSqlClient();
  if (!client) return [];
  const core = coreTableFor(collection);
  const params: unknown[] = [];
  // Platform-scope rows (CSP reports) are stored without a tenant
  const tenantClause = tenantId === PLATFORM_SCOPE ? "tenant_id IS NULL" : `tenant_id = $${params.push(tenantId)}`;
  let sql: string;
  if (core) {
    sql = `SELECT data, version::text AS version FROM ${qualified(core.table)} WHERE ${tenantClause}`;
  } else {
    sql = `SELECT data, version::text AS version FROM ${qualified("documents")} WHERE ${tenantClause} AND collection = $${params.push(collection)}`;
  }
  if (filter) {
    params.push([...filter.values]);
    const column =
      filter.field === "id" || (core && GENERATED_TEXT_COLUMNS[collection]?.includes(filter.field))
        ? filter.field
        : `data->>'${filter.field}'`;
    sql += ` AND ${column} = ANY($${params.length}::text[])`;
  }
  sql += " ORDER BY seq";
  const res = await client.query<{ data: unknown; version: string }>(sql, params);
  return res.rows.map((r) => ({ row: parseRowData<Row>(r.data), version: Number(r.version) }));
}

function checkFilter(filter: RowFilter | undefined): void {
  if (filter && !FIELD_NAME.test(filter.field)) throw new Error(`Invalid filter field '${filter.field}'.`);
}

/** Every row of `collection` for `tenantId` (optionally narrowed by one field), in insertion order. */
export async function readTenantRows<T>(collection: string, tenantId: string, filter?: RowFilter): Promise<T[]> {
  checkFilter(filter);
  if (filter && filter.values.length === 0) return [];
  if (db.isCollectionHydrated(collection)) {
    const list = (db.data as unknown as Record<string, Row[] | undefined>)[collection] ?? [];
    return list.filter((r) => r.tenant_id === tenantId && matches(r, filter)) as T[];
  }
  // This request's working set when it holds every row (it may include rows the request changed)
  const loaded = db.tenantReadRows(collection, tenantId);
  if (loaded) return loaded.filter((r) => matches(r, filter)) as T[];
  return (await selectRows(collection, tenantId, filter)).map((r) => r.row as T);
}

/** One row by id, or null; never another tenant's. */
export async function readTenantRow<T>(collection: string, tenantId: string, id: string): Promise<T | null> {
  const rows = await readTenantRows<T>(collection, tenantId, { field: "id", values: [id] });
  return rows[0] ?? null;
}

const SCOPE_REQUIRED = "Zero-hydration rows are loaded inside a request (withStore) or a db.withTenantReads scope.";

/**
 * Loads every row of the tenant's collections into the current working set, so the store's synchronous scans
 * (getAllOrders, getInventory, the analytics) can answer for that tenant. Hydrated collections and ones already loaded
 * are skipped. A change the request then makes through a repository's own SQL isn't reflected.
 */
export async function loadTenantRows(tenantId: string, collections: readonly string[]): Promise<void> {
  for (const collection of collections) {
    if (db.isCollectionHydrated(collection) || db.tenantReadRows(collection, tenantId)) continue;
    const rows = await selectRows(collection, tenantId);
    if (!db.putTenantReadRows(collection, tenantId, rows, true)) throw new Error(SCOPE_REQUIRED);
  }
}

/**
 * Loads the tenant's rows of one collection matching `filter` into the current working set: what a write flow (an
 * order's status change, a stock adjustment) reads and changes through the store's synchronous methods.
 */
export async function loadTenantRowsWhere(tenantId: string, collection: string, filter: RowFilter): Promise<Row[]> {
  checkFilter(filter);
  if (db.isCollectionHydrated(collection)) return readTenantRows<Row>(collection, tenantId, filter);
  if (db.tenantReadRows(collection, tenantId)) return readTenantRows<Row>(collection, tenantId, filter);
  const values = [...new Set(filter.values.filter(Boolean))];
  const rows = values.length ? await selectRows(collection, tenantId, { field: filter.field, values }) : [];
  if (!db.putTenantReadRows(collection, tenantId, rows, false)) throw new Error(SCOPE_REQUIRED);
  // The working set's copies: rows this request already holds keep their in-scope state
  const held = new Map((db.tenantRowSet(collection, tenantId)?.rows ?? []).map((r) => [String(r.id), r]));
  return rows.map((r) => held.get(String(r.row.id)) ?? r.row);
}

/** What the commerce analytics read (orders with items and customers, the catalog with stock). */
export const COMMERCE_ANALYTICS_COLLECTIONS = [
  "orders",
  "order_items",
  "customers",
  "customer_addresses",
  "products",
  "product_variants",
  "inventory_items",
  "warehouses",
] as const;

/** The commerce analytics plus procurement and stock history (operations twin, pricing, replenishment). */
export const OPERATIONS_COLLECTIONS = [
  ...COMMERCE_ANALYTICS_COLLECTIONS,
  "suppliers",
  "supplier_products",
  "purchase_orders",
  "stock_movements",
  "inventory_reservations",
] as const;

const field = (rows: Row[], name: string) => rows.map((r) => r[name]).filter((v): v is string => typeof v === "string");

/**
 * An order's rows for a flow that reads or changes it through the store (status changes, payments, shipping,
 * returns): the order, its items, customer and addresses, stock reservations and the stock they hold, the variants
 * and products it sold, and the tenant's warehouses.
 */
export async function loadOrderRows(tenantId: string, orderIds: readonly string[]): Promise<void> {
  const orders = await loadTenantRowsWhere(tenantId, "orders", { field: "id", values: orderIds });
  const items = await loadTenantRowsWhere(tenantId, "order_items", { field: "order_id", values: orderIds });
  const customerIds = field(orders, "customer_id");
  await loadTenantRowsWhere(tenantId, "customers", { field: "id", values: customerIds });
  await loadTenantRowsWhere(tenantId, "customer_addresses", { field: "customer_id", values: customerIds });
  const reservations = await loadTenantRowsWhere(tenantId, "inventory_reservations", { field: "order_id", values: orderIds });
  const variantIds = [...field(items, "variant_id"), ...field(items, "product_variant_id"), ...field(reservations, "product_variant_id")];
  await loadVariantRows(tenantId, variantIds);
}

/** Variants with their products and stock rows, and the tenant's warehouses (pricing, stock changes). */
export async function loadVariantRows(tenantId: string, variantIds: readonly string[]): Promise<void> {
  const variants = await loadTenantRowsWhere(tenantId, "product_variants", { field: "id", values: variantIds });
  await loadTenantRowsWhere(tenantId, "products", { field: "id", values: field(variants, "product_id") });
  await loadTenantRowsWhere(tenantId, "inventory_items", { field: "product_variant_id", values: variantIds });
  await loadTenantRows(tenantId, ["warehouses"]);
}

/** Stock reservations by id, with the stock rows they hold. */
export async function loadReservationRows(tenantId: string, reservationIds: readonly string[]): Promise<void> {
  const reservations = await loadTenantRowsWhere(tenantId, "inventory_reservations", { field: "id", values: reservationIds });
  await loadVariantRows(tenantId, field(reservations, "product_variant_id"));
}

/** Products with their variants and stock rows. */
export async function loadProductRows(tenantId: string, productIds: readonly string[]): Promise<void> {
  await loadTenantRowsWhere(tenantId, "products", { field: "id", values: productIds });
  const variants = await loadTenantRowsWhere(tenantId, "product_variants", { field: "product_id", values: productIds });
  await loadVariantRows(tenantId, field(variants, "id"));
}

/** Customers with their addresses and channel identities. */
export async function loadCustomerRows(tenantId: string, customerIds: readonly string[]): Promise<void> {
  await loadTenantRowsWhere(tenantId, "customers", { field: "id", values: customerIds });
  await loadTenantRowsWhere(tenantId, "customer_addresses", { field: "customer_id", values: customerIds });
  await loadTenantRowsWhere(tenantId, "customer_identities", { field: "customer_id", values: customerIds });
}
