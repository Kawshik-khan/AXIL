/**
 * Customer segments and list sorts for the Customers page. A segment is worked out from the customer's own order
 * counters (total_orders, total_spent), never stored and never guessed: the in-memory store and the SQL repository
 * apply the same rules (see segmentSqlCondition), so a filter returns the same rows on either backend.
 */
import type { Customer } from "@/types/commerce";
import type { ChannelType } from "@/types/social";

/** Lifetime spend (BDT) from which a customer counts as high value. Business config: change it here, not in UI copy. */
export const HIGH_VALUE_LIFETIME_SPEND_BDT = 25_000;
/** Orders from which a customer counts as a repeat buyer. */
export const REPEAT_MIN_ORDERS = 2;

export const CUSTOMER_SEGMENTS = ["NEW", "ONE_TIME", "REPEAT", "HIGH_VALUE"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CUSTOMER_SORTS = ["newest", "lifetime_value", "orders", "last_order", "name"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type SegmentCounts = Record<CustomerSegment, number>;

/** A row of the customer list: the customer plus its segment and the chat channels it has written from. */
export type CustomerListItem = Customer & { segment: CustomerSegment; channels: ChannelType[] };

export function customerSegment(c: Pick<Customer, "total_orders" | "total_spent">): CustomerSegment {
  const orders = Number(c.total_orders ?? 0);
  const spent = Number(c.total_spent ?? 0);
  if (!(orders > 0)) return "NEW";
  if (spent >= HIGH_VALUE_LIFETIME_SPEND_BDT) return "HIGH_VALUE";
  if (orders >= REPEAT_MIN_ORDERS) return "REPEAT";
  return "ONE_TIME";
}

export function emptySegmentCounts(): SegmentCounts {
  return { NEW: 0, ONE_TIME: 0, REPEAT: 0, HIGH_VALUE: 0 };
}

export function countSegments(customers: Iterable<Pick<Customer, "total_orders" | "total_spent">>): SegmentCounts {
  const counts = emptySegmentCounts();
  for (const c of customers) counts[customerSegment(c)] += 1;
  return counts;
}

/**
 * SQL expressions over `data` matching customerSegment exactly. The thresholds are the numeric constants above
 * (never request input), written into the SQL as numbers.
 */
export const SQL_ORDERS = `COALESCE((data->>'total_orders')::numeric, 0)`;
export const SQL_SPENT = `COALESCE((data->>'total_spent')::numeric, 0)`;

export function segmentSqlCondition(segment: CustomerSegment): string {
  const highValueParam = String(Number(HIGH_VALUE_LIFETIME_SPEND_BDT));
  const repeatParam = String(Number(REPEAT_MIN_ORDERS));
  switch (segment) {
    case "NEW":
      return `${SQL_ORDERS} <= 0`;
    case "HIGH_VALUE":
      return `(${SQL_ORDERS} > 0 AND ${SQL_SPENT} >= ${highValueParam})`;
    case "REPEAT":
      return `(${SQL_ORDERS} >= ${repeatParam} AND ${SQL_SPENT} < ${highValueParam})`;
    case "ONE_TIME":
      return `(${SQL_ORDERS} > 0 AND ${SQL_ORDERS} < ${repeatParam} AND ${SQL_SPENT} < ${highValueParam})`;
  }
}

/** ORDER BY for each sort; every one ends on created_at and id so pages never overlap. */
export const SORT_SQL: Record<CustomerSort, string> = {
  newest: `created_at DESC NULLS LAST, id DESC`,
  lifetime_value: `${SQL_SPENT} DESC, created_at DESC NULLS LAST, id DESC`,
  orders: `${SQL_ORDERS} DESC, created_at DESC NULLS LAST, id DESC`,
  last_order: `(data->>'last_order_at') DESC NULLS LAST, created_at DESC NULLS LAST, id DESC`,
  name: `lower(data->>'first_name') ASC, lower(data->>'last_name') ASC, id ASC`,
};

function time(value: string | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function newestFirst(a: Customer, b: Customer): number {
  return time(b.created_at) - time(a.created_at) || ascending(b.id, a.id);
}

/** The in-memory twin of SORT_SQL. */
export function compareCustomers(sort: CustomerSort): (a: Customer, b: Customer) => number {
  switch (sort) {
    case "lifetime_value":
      return (a, b) => Number(b.total_spent ?? 0) - Number(a.total_spent ?? 0) || newestFirst(a, b);
    case "orders":
      return (a, b) => Number(b.total_orders ?? 0) - Number(a.total_orders ?? 0) || newestFirst(a, b);
    case "last_order":
      return (a, b) => {
        const la = a.last_order_at ?? "";
        const lb = b.last_order_at ?? "";
        if (la !== lb) {
          if (!la) return 1;
          if (!lb) return -1;
          return la < lb ? 1 : -1;
        }
        return newestFirst(a, b);
      };
    case "name":
      return (a, b) =>
        ascending((a.first_name ?? "").toLowerCase(), (b.first_name ?? "").toLowerCase()) ||
        ascending((a.last_name ?? "").toLowerCase(), (b.last_name ?? "").toLowerCase()) ||
        ascending(a.id, b.id);
    case "newest":
    default:
      return newestFirst;
  }
}
