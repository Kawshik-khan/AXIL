/**
 * Where each store collection lives in Postgres (migration 006, ADR-108). Collections listed here have their own table
 * with constraints; every other collection is stored as JSONB documents in `commerceos.documents`.
 *
 * The order matters: parents come before children. The row-by-row fallback writes in this order (and deletes in
 * reverse) with constraints checked immediately.
 */
import type { DatabaseSchema } from "@/infrastructure/db";

export const STORE_SCHEMA = "commerceos";

export interface CoreTable {
  table: string;
  /** "self": the tenant's own id (tenants table); "record": the record's tenant_id; "none": platform-scope rows. */
  tenant: "self" | "record" | "none";
}

type ArrayCollection = { [K in keyof DatabaseSchema]: DatabaseSchema[K] extends unknown[] ? K : never }[keyof DatabaseSchema];

export const CORE_TABLES: Partial<Record<ArrayCollection, CoreTable>> = {
  tenants: { table: "tenants", tenant: "self" },
  users: { table: "users", tenant: "none" },
  memberships: { table: "memberships", tenant: "record" },
  invitations: { table: "invitations", tenant: "record" },
  audit_logs: { table: "audit_logs", tenant: "record" },
  service_tokens: { table: "service_tokens", tenant: "record" },
  platform_memberships: { table: "platform_memberships", tenant: "none" },
  impersonation_sessions: { table: "impersonation_sessions", tenant: "none" },
  products: { table: "products", tenant: "record" },
  product_variants: { table: "product_variants", tenant: "record" },
  categories: { table: "categories", tenant: "record" },
  brands: { table: "brands", tenant: "record" },
  warehouses: { table: "warehouses", tenant: "record" },
  inventory_items: { table: "inventory_items", tenant: "record" },
  stock_movements: { table: "stock_movements", tenant: "record" },
  inventory_reservations: { table: "inventory_reservations", tenant: "record" },
  customers: { table: "customers", tenant: "record" },
  customer_addresses: { table: "customer_addresses", tenant: "record" },
  orders: { table: "orders", tenant: "record" },
  order_items: { table: "order_items", tenant: "record" },
  payments: { table: "payments", tenant: "record" },
  shipments: { table: "shipments", tenant: "record" },
  returns: { table: "returns", tenant: "record" },
  refunds: { table: "refunds", tenant: "record" },
  coupons: { table: "coupons", tenant: "record" },
  events: { table: "events", tenant: "record" },
  connected_channels: { table: "connected_channels", tenant: "record" },
  customer_identities: { table: "customer_identities", tenant: "record" },
  conversations: { table: "conversations", tenant: "record" },
  messages: { table: "messages", tenant: "record" },
  leads: { table: "leads", tenant: "record" },
  automation_workflows: { table: "automation_workflows", tenant: "record" },
  automation_executions: { table: "automation_executions", tenant: "record" },
};

/** Collections the store keeps newest-first (it inserts at the front); they're read back in that order. */
export const NEWEST_FIRST_COLLECTIONS = new Set<string>([
  "executive_digests",
  "impersonation_sessions",
  "platform_announcements",
  "platform_audit_logs",
  "platform_incidents",
  "platform_security_events",
]);

/** Collections whose records have no `id`: the store identifies them by these fields (as its own methods do). */
export const NATURAL_KEYS: Record<string, string[]> = {
  tenant_entitlements: ["tenant_id", "entitlement_id"],
  platform_settings: ["key"],
  supplier_performances: ["tenant_id", "supplier_id"],
  courier_performances: ["tenant_id", "courier_provider"],
  global_events: ["event_id"],
};

/** The row id Postgres stores a record under, or null when the record has none. */
export function recordId(collection: string, record: Record<string, unknown>): string | null {
  const fields = NATURAL_KEYS[collection];
  if (fields) {
    const parts = fields.map((f) => record[f]);
    if (parts.some((p) => (typeof p !== "string" && typeof p !== "number") || p === "")) return null;
    return parts.map((p) => encodeURIComponent(String(p))).join(":");
  }
  const id = record.id;
  if ((typeof id !== "string" && typeof id !== "number") || id === "") return null;
  return String(id);
}

/** The one non-array collection with its own table; any other non-array value goes to store_meta. */
export const ORDER_SEQUENCES_KEY = "order_sequences";

export function coreTableFor(collection: string): CoreTable | undefined {
  return Object.hasOwn(CORE_TABLES, collection) ? (CORE_TABLES as Record<string, CoreTable>)[collection] : undefined;
}

export function qualified(table: string): string {
  return `${STORE_SCHEMA}.${table}`;
}

/** Every table that holds store data, children before parents (for TRUNCATE and deletes). */
export function storeTablesChildrenFirst(): string[] {
  const core = Object.values(CORE_TABLES).map((t) => (t as CoreTable).table);
  return ["refused_rows", "documents", "store_meta", "order_sequences", ...core.reverse()];
}
