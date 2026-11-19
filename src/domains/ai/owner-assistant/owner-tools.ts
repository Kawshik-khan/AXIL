/**
 * The Owner Assistant's tools (ADR-127). Read-only: each wraps existing repositories / store reads for the principal's
 * tenant, takes a strict Zod input, and returns small JSON with explicit numbers, so the model never computes a number
 * itself (changes and percentages are computed here). The tenant always comes from the principal, never the input.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { readTenantRows } from "@/infrastructure/db/tenant-rows";
import { orderRepository } from "@/domains/orders/order.repository";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import type { LLMToolDefinition } from "@/domains/ai/providers/llm-provider.interface";
import type { Order, OrderItem } from "@/types/commerce";
import { PERIODS, PeriodSchema, resolvePeriod, type PeriodWindow } from "./periods";

export interface OwnerPrincipal {
  tenantId: string;
  tenantName: string;
  timezone: string;
  userId: string;
  permissions: readonly Permission[];
}

export type OwnerToolResult = Record<string, unknown>;

interface OwnerTool {
  def: LLMToolDefinition;
  /** The caller must hold this permission; the model is never offered a tool its user can't use. */
  permission: Permission;
  input: z.ZodType<Record<string, unknown>>;
  run(pr: OwnerPrincipal, input: Record<string, unknown>): Promise<OwnerToolResult>;
}

const round = (n: number, places = 0) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Change from `prev` to `cur`: absolute and percent (null when there is nothing to compare against). */
function change(cur: number, prev: number) {
  return { previous: round(prev, 2), change: round(cur - prev, 2), change_pct: prev > 0 ? round(((cur - prev) / prev) * 100, 1) : null };
}

const periodProp = { type: "string", enum: [...PERIODS], description: "Report period in the shop's timezone. Default: today." };
const limitProp = { type: "integer", minimum: 1, maximum: 10, description: "How many to list (1-10). Default 5." };

const PeriodInput = z.object({ period: PeriodSchema.default("today") }).strict();
const PeriodLimitInput = z.object({ period: PeriodSchema.default("last_7_days"), limit: z.number().int().min(1).max(10).default(5) }).strict();
const LimitInput = z.object({ limit: z.number().int().min(1).max(10).default(5) }).strict();
const NoInput = z.object({}).strict();

const describe = (w: PeriodWindow) => ({ period: w.period, from_date: w.from_date, to_date: w.to_date });

async function ordersIn(pr: OwnerPrincipal, from: string, to: string): Promise<Order[]> {
  return orderRepository.findInWindow(pr.tenantId, from, to);
}

async function itemsOf(pr: OwnerPrincipal, orderIds: string[]): Promise<OrderItem[]> {
  const out: OrderItem[] = [];
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    out.push(...(await readTenantRows<OrderItem>("order_items", pr.tenantId, { field: "order_id", values: chunk })));
  }
  return out;
}

function salesFigures(orders: Order[]) {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const revenue = live.reduce((n, o) => n + (o.grand_total || 0), 0);
  const byStatus: Record<string, number> = {};
  const byPayment: Record<string, number> = {};
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    if (o.status !== "CANCELLED") byPayment[o.payment_method] = (byPayment[o.payment_method] ?? 0) + 1;
  }
  return {
    orders: orders.length,
    cancelled: orders.length - live.length,
    revenue_bdt: round(revenue, 2),
    average_order_bdt: live.length ? round(revenue / live.length, 2) : 0,
    by_status: byStatus,
    by_payment_method: byPayment,
  };
}

export const OWNER_TOOLS: Record<string, OwnerTool> = {
  get_sales_summary: {
    permission: PERMISSIONS.ANALYTICS_READ,
    input: PeriodInput,
    def: {
      name: "get_sales_summary",
      description:
        "Orders, cancellations, revenue (BDT, cancelled orders excluded), average order value, orders by status and by payment method for a period, each compared with the period just before it.",
      parameters: { type: "object", properties: { period: periodProp } },
    },
    async run(pr, input) {
      const w = resolvePeriod(input.period as PeriodWindow["period"], pr.timezone);
      const [cur, prev] = await Promise.all([ordersIn(pr, w.from, w.to), ordersIn(pr, w.previous.from, w.previous.to)]);
      const a = salesFigures(cur);
      const b = salesFigures(prev);
      return {
        ...describe(w),
        currency: "BDT",
        ...a,
        compared_with: { from_date: w.previous.from_date, to_date: w.previous.to_date },
        orders_change: change(a.orders, b.orders),
        revenue_change: change(a.revenue_bdt, b.revenue_bdt),
        cancelled_change: change(a.cancelled, b.cancelled),
      };
    },
  },

  get_top_products: {
    permission: PERMISSIONS.ANALYTICS_READ,
    input: PeriodLimitInput,
    def: {
      name: "get_top_products",
      description: "Best-selling products by units in a period (cancelled orders excluded), with units and sales in BDT.",
      parameters: { type: "object", properties: { period: periodProp, limit: limitProp } },
    },
    async run(pr, input) {
      const w = resolvePeriod(input.period as PeriodWindow["period"], pr.timezone);
      const live = (await ordersIn(pr, w.from, w.to)).filter((o) => o.status !== "CANCELLED");
      const items = await itemsOf(pr, live.map((o) => o.id));
      const byVariant = new Map<string, { name: string; sku: string; units: number; sales_bdt: number }>();
      for (const it of items) {
        const row = byVariant.get(it.variant_id) ?? { name: it.product_name_snapshot, sku: it.sku_snapshot, units: 0, sales_bdt: 0 };
        row.units += it.quantity;
        row.sales_bdt += it.line_total;
        byVariant.set(it.variant_id, row);
      }
      const ranked = [...byVariant.values()]
        .sort((x, y) => y.units - x.units || y.sales_bdt - x.sales_bdt)
        .slice(0, input.limit as number)
        .map((r, i) => ({ rank: i + 1, product: r.name, sku: r.sku, units: r.units, sales_bdt: round(r.sales_bdt, 2) }));
      return { ...describe(w), currency: "BDT", orders_counted: live.length, products: ranked };
    },
  },

  get_low_stock: {
    permission: PERMISSIONS.INVENTORY_READ,
    input: LimitInput,
    def: {
      name: "get_low_stock",
      description:
        "Items at or below their reorder point or sold out, with stock available, reorder point, average daily sales over the last 30 days and days of stock left at that rate.",
      parameters: { type: "object", properties: { limit: limitProp } },
    },
    async run(pr, input) {
      const [levels, velocity] = await Promise.all([inventoryRepository.getStockLevels(pr.tenantId), orderRepository.getVariantSalesVelocity(pr.tenantId, 30)]);
      const low = levels.filter((i) => i.quantity_available <= 0 || (i.reorder_point > 0 && i.quantity_available <= i.reorder_point));
      const rows = low
        .map((i) => {
          const sold30 = velocity[i.product_variant_id] ?? 0;
          const perDay = sold30 / 30;
          return {
            product: i.variant_title && i.variant_title !== "Default" ? `${i.product_name} (${i.variant_title})` : i.product_name,
            sku: i.sku,
            available: i.quantity_available,
            reorder_point: i.reorder_point,
            sold_last_30_days: sold30,
            average_daily_sales: round(perDay, 2),
            days_of_stock_left: perDay > 0 ? round(Math.max(0, i.quantity_available) / perDay, 1) : null,
            sold_out: i.quantity_available <= 0,
          };
        })
        .sort((a, b) => (a.days_of_stock_left ?? Number.POSITIVE_INFINITY) - (b.days_of_stock_left ?? Number.POSITIVE_INFINITY) || a.available - b.available);
      return { low_stock_items: low.length, sold_out_items: rows.filter((r) => r.sold_out).length, items: rows.slice(0, input.limit as number) };
    },
  },

  get_delivery_issues: {
    permission: PERMISSIONS.SHIPMENTS_READ,
    input: PeriodInput,
    def: {
      name: "get_delivery_issues",
      description: "Shipments in a period: total, delivered, failed, returned, still in transit, and failed/returned counts per courier.",
      parameters: { type: "object", properties: { period: periodProp } },
    },
    async run(pr, input) {
      const w = resolvePeriod(input.period as PeriodWindow["period"], pr.timezone);
      const shipments = db.getShipments(pr.tenantId).filter((s) => s.created_at >= w.from && s.created_at < w.to);
      const count = (st: string[]) => shipments.filter((s) => st.includes(s.status)).length;
      const perCourier: Record<string, { failed: number; returned: number; total: number }> = {};
      for (const s of shipments) {
        const c = (perCourier[s.courier_provider] ??= { failed: 0, returned: 0, total: 0 });
        c.total++;
        if (s.status === "FAILED") c.failed++;
        if (s.status === "RETURNED") c.returned++;
      }
      return {
        ...describe(w),
        shipments: shipments.length,
        delivered: count(["DELIVERED"]),
        failed: count(["FAILED"]),
        returned: count(["RETURNED"]),
        in_transit: count(["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"]),
        not_picked_up: count(["PENDING"]),
        by_courier: perCourier,
      };
    },
  },

  get_returns_summary: {
    permission: PERMISSIONS.RETURNS_READ,
    input: PeriodInput,
    def: {
      name: "get_returns_summary",
      description: "Return requests in a period: total, by status, and the most common reasons (as customers gave them).",
      parameters: { type: "object", properties: { period: periodProp } },
    },
    async run(pr, input) {
      const w = resolvePeriod(input.period as PeriodWindow["period"], pr.timezone);
      const returns = db.getReturns(pr.tenantId).filter((r) => r.created_at >= w.from && r.created_at < w.to);
      const byStatus: Record<string, number> = {};
      const reasons = new Map<string, number>();
      for (const r of returns) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        // Customer-written: phone or order-like digit runs are masked (the answer may go to a group chat)
        const reason = (r.reason || "not given").trim().toLowerCase().replace(/[+\d][\d\s-]{5,}\d/g, "[number]").slice(0, 80);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));
      return { ...describe(w), returns: returns.length, by_status: byStatus, top_reasons: top };
    },
  },

  get_cod_outstanding: {
    permission: PERMISSIONS.PAYMENTS_READ,
    input: NoInput,
    def: {
      name: "get_cod_outstanding",
      description: "Cash-on-delivery money delivered to customers but not yet reconciled from couriers (BDT).",
      parameters: { type: "object", properties: {} },
    },
    async run(pr) {
      const total = await orderRepository.getUnreconciledCodTotal(pr.tenantId);
      return { currency: "BDT", unreconciled_cod_bdt: round(total, 2) };
    },
  },

  get_open_escalations: {
    permission: PERMISSIONS.SOCIAL_CONVERSATION_READ,
    input: NoInput,
    def: {
      name: "get_open_escalations",
      description: "Customer chats handed to a person and not resolved yet: how many, by priority, and the oldest waiting time in minutes.",
      parameters: { type: "object", properties: {} },
    },
    async run(pr) {
      const open = db.getAgentHitlEscalations(pr.tenantId).filter((e) => e.status === "PENDING_REVIEW" || e.status === "CLAIMED");
      const byPriority: Record<string, number> = {};
      for (const e of open) byPriority[e.priority] = (byPriority[e.priority] ?? 0) + 1;
      const oldest = open.reduce<string | null>((min, e) => (!min || e.created_at < min ? e.created_at : min), null);
      return {
        open_escalations: open.length,
        waiting_for_review: open.filter((e) => e.status === "PENDING_REVIEW").length,
        by_priority: byPriority,
        oldest_waiting_minutes: oldest ? Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 60_000)) : null,
      };
    },
  },
};

export type OwnerToolName = keyof typeof OWNER_TOOLS;

/** The tools this principal may use (by permission). */
export function toolsFor(pr: OwnerPrincipal): OwnerTool[] {
  return Object.values(OWNER_TOOLS).filter((t) => pr.permissions.includes(t.permission));
}

export interface OwnerToolOutcome {
  ok: boolean;
  result: OwnerToolResult;
}

/**
 * Runs one tool for the principal. Refuses tools the principal can't use, and inputs that don't match the schema
 * (the model sees the refusal and can retry). Never throws for a bad call; a data failure is returned as an error.
 */
export async function runOwnerTool(pr: OwnerPrincipal, name: string, rawInput: unknown): Promise<OwnerToolOutcome> {
  const tool = OWNER_TOOLS[name];
  if (!tool) return { ok: false, result: { error: "UNKNOWN_TOOL", message: `No tool named ${name}.` } };
  if (!pr.permissions.includes(tool.permission)) {
    return { ok: false, result: { error: "NOT_PERMITTED", message: "This person's role can't see this information." } };
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, result: { error: "INVALID_INPUT", message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } };
  }
  try {
    return { ok: true, result: await tool.run(pr, parsed.data) };
  } catch {
    return { ok: false, result: { error: "DATA_UNAVAILABLE", message: "This information couldn't be read right now." } };
  }
}
