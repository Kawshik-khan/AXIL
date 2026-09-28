/**
 * Data written by code that made values up, cleaned for stores created before the fixes:
 * - FX-36 M15: identity resolution gave social customers without a phone a random "+8801700…" number (it could be a
 *   real person's). Those customers are recognisable by the note "Ingressed from …"; their phone is cleared.
 * - FX-36 M5: the manual order form stored every outside-Dhaka order as division and district "Chittagong" (the old
 *   spelling; the district list uses "Chattogram"). Those orders are marked address_confidence UNKNOWN and left out of
 *   RTO geography; the address itself is kept.
 * Pure over the data; `apply: false` only reports.
 */
import type { Customer, Order } from "@/types/commerce";

const FABRICATED_PHONE = /^\+8801700\d{6}$/;

export interface FabricatedDataReport {
  customers_phone_cleared: number;
  orders_address_flagged: number;
}

export function fixFabricatedData(data: { customers: Customer[]; orders: Order[] }, opts: { apply: boolean }): FabricatedDataReport {
  const customers = data.customers.filter((c) => FABRICATED_PHONE.test(c.phone ?? "") && (c.notes ?? "").includes("Ingressed from"));
  const orders = data.orders.filter(
    (o) =>
      o.address_confidence !== "UNKNOWN" &&
      o.shipping_address_snapshot?.district === "Chittagong" &&
      o.shipping_address_snapshot?.division === "Chittagong"
  );
  if (opts.apply) {
    const now = new Date().toISOString();
    for (const c of customers) {
      c.phone = "";
      c.updated_at = now;
    }
    for (const o of orders) {
      o.address_confidence = "UNKNOWN";
      o.updated_at = now;
    }
  }
  return { customers_phone_cleared: customers.length, orders_address_flagged: orders.length };
}
