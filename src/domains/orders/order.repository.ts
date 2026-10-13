/**
 * CommerceOS — Order Repository
 * Authoritative data access for orders and order items.
 *
 * Implements high-performance Keyset (Cursor) Pagination over Neon PostgreSQL (commerceos schema)
 * with seamless fallback to in-memory store for offline test execution.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { db } from '@/infrastructure/db';
import type { SqlClient, SqlExecutor } from '@/infrastructure/store/sql-client';
import { StoreConflictError } from '@/infrastructure/store/pg-store';
import { Order, OrderItem, OrderStatus, Customer } from '@/types/commerce';
import type { SalesChannel } from '@/types/analytics';
import { channelOfOrder } from '@/lib/sales-channel';
import {
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  sliceForCursor,
  type CursorPaginatedResult,
} from '@/lib/cursor-pagination';

function parseJsonData<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

export class OrderRepository extends BaseRepository<Order> {
  constructor() {
    super('orders', 'id');
  }

  /** SQL only when orders is left out of memory (zero-hydration); otherwise the in-memory store is the source of truth. */
  private getClient(): SqlClient | null {
    return db.isCollectionHydrated("orders") ? null : db.getSqlClient();
  }

  async findById(
    tenantId: string,
    id: string
  ): Promise<(Order & { customer_name?: string; customer_phone?: string }) | null> {
    const client = this.getClient();
    if (!client) {
      return (db.findOrderById(tenantId, id) as any) || null;
    }

    const rowRes = await client.query<{ data: Order | string }>(
      `SELECT data FROM commerceos.orders WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;

    const order = parseJsonData<Order>(row.data);
    const itemRows = await client.query<{ data: OrderItem | string }>(
      `SELECT data FROM commerceos.order_items WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, id]
    );

    let customerName = (order as any).customer_name;
    let customerPhone = (order as any).customer_phone;

    if (order.customer_id && (!customerName || !customerPhone)) {
      const custRes = await client.query<{ data: { first_name?: string; last_name?: string; full_name?: string; phone?: string } | string }>(
        `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, order.customer_id]
      );
      const custRow = custRes.rows[0];
      if (custRow?.data) {
        const custData = parseJsonData<{ first_name?: string; last_name?: string; full_name?: string; phone?: string }>(custRow.data);
        customerName =
          custData.full_name ||
          `${custData.first_name || ''} ${custData.last_name || ''}`.trim();
        customerPhone = custData.phone;
      }
    }

    return {
      ...order,
      subtotal: Number(order.subtotal || 0),
      shipping_total: Number(order.shipping_total || (order as any).delivery_charge || 0),
      discount_total: Number(order.discount_total || (order as any).discount || 0),
      grand_total: Number(order.grand_total || (order as any).total || 0),
      items: itemRows.rows.map((i) => parseJsonData<OrderItem>(i.data)),
      customer_name: customerName,
      customer_phone: customerPhone,
    };
  }

  async findByOrderNumber(
    tenantId: string,
    orderNumber: string
  ): Promise<(Order & { customer_name?: string; customer_phone?: string }) | null> {
    const client = this.getClient();
    if (!client) {
      const match =
        db.findOrderByNumber(tenantId, orderNumber) ||
        db.getAllOrders(tenantId).find((o) => o.order_number.toLowerCase() === orderNumber.toLowerCase());
      return (match as any) || null;
    }

    const rowRes = await client.query<{ data: Order | string }>(
      `SELECT data FROM commerceos.orders WHERE tenant_id = $1 AND (order_number = $2 OR lower(order_number) = lower($2)) LIMIT 1`,
      [tenantId, orderNumber]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;

    const order = parseJsonData<Order>(row.data);
    const itemRows = await client.query<{ data: OrderItem | string }>(
      `SELECT data FROM commerceos.order_items WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, order.id]
    );

    let customerName = (order as any).customer_name;
    let customerPhone = (order as any).customer_phone;

    if (order.customer_id && (!customerName || !customerPhone)) {
      const custRes = await client.query<{ data: { first_name?: string; last_name?: string; full_name?: string; phone?: string } | string }>(
        `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, order.customer_id]
      );
      const custRow = custRes.rows[0];
      if (custRow?.data) {
        const custData = parseJsonData<{ first_name?: string; last_name?: string; full_name?: string; phone?: string }>(custRow.data);
        customerName =
          custData.full_name ||
          `${custData.first_name || ''} ${custData.last_name || ''}`.trim();
        customerPhone = custData.phone;
      }
    }

    return {
      ...order,
      subtotal: Number(order.subtotal || 0),
      shipping_total: Number(order.shipping_total || (order as any).delivery_charge || 0),
      discount_total: Number(order.discount_total || (order as any).discount || 0),
      grand_total: Number(order.grand_total || (order as any).total || 0),
      items: itemRows.rows.map((i) => parseJsonData<OrderItem>(i.data)),
      customer_name: customerName,
      customer_phone: customerPhone,
    };
  }

  async countByTenant(tenantId: string, status?: string): Promise<number> {
    const client = this.getClient();
    if (client) {
      const sql = status
        ? `SELECT count(*)::text AS total FROM commerceos.orders WHERE tenant_id = $1 AND status = $2`
        : `SELECT count(*)::text AS total FROM commerceos.orders WHERE tenant_id = $1`;
      const params = status ? [tenantId, status] : [tenantId];
      const res = await client.query<{ total: string }>(sql, params);
      return Number(res.rows[0]?.total ?? 0);
    }
    if (!db.isCollectionHydrated("orders")) return 0;
    const all = db.getAllOrders(tenantId);
    return status ? all.filter((o) => o.status === status).length : all.length;
  }

  async sumRevenueByTenant(tenantId: string): Promise<{ revenue: number; totalOrders: number }> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ revenue: string; total_orders: string }>(
        `SELECT coalesce(sum(grand_total), 0)::text AS revenue, count(*)::text AS total_orders FROM commerceos.orders WHERE tenant_id = $1 AND status != 'CANCELLED'`,
        [tenantId]
      );
      return {
        revenue: Number(res.rows[0]?.revenue ?? 0),
        totalOrders: Number(res.rows[0]?.total_orders ?? 0),
      };
    }
    if (!db.isCollectionHydrated("orders")) return { revenue: 0, totalOrders: 0 };
    const live = db.getAllOrders(tenantId).filter((o) => o.status !== 'CANCELLED');
    const revenue = live.reduce((sum, o) => sum + (o.grand_total || (o as any).total || 0), 0);
    return { revenue, totalOrders: live.length };
  }

  /**
   * Bounded query for orders within a date window.
   * Only transfers records for the requested window, avoiding full historical table hydration.
   */
  async findInWindow(
    tenantId: string,
    startIso: string,
    endIso: string,
    options?: { hydrate?: boolean }
  ): Promise<(Order & { customer_name?: string; customer_phone?: string })[]> {
    const client = this.getClient();
    if (!client) {
      const from = new Date(startIso).getTime();
      const to = new Date(endIso).getTime();
      const all = db.getAllOrders(tenantId, options as any);
      return all.filter((o) => {
        const t = new Date(o.created_at).getTime();
        return t >= from && t <= to && o.status !== "CANCELLED";
      }) as any;
    }

    const orderRows = await client.query<{ data: Order | string }>(
      `SELECT data FROM commerceos.orders
       WHERE tenant_id = $1 AND status != 'CANCELLED' AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at DESC`,
      [tenantId, startIso, endIso]
    );
    const orders = orderRows.rows.map((r) => parseJsonData<Order>(r.data));
    if (!options?.hydrate || orders.length === 0) return orders;

    const orderIds = orders.map((o) => o.id);
    const itemRows = await client.query<{ data: OrderItem | string }>(
      `SELECT data FROM commerceos.order_items WHERE tenant_id = $1 AND order_id = ANY($2)`,
      [tenantId, orderIds]
    );
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const r of itemRows.rows) {
      const it = parseJsonData<OrderItem>(r.data);
      const list = itemsByOrder.get(it.order_id);
      if (list) list.push(it);
      else itemsByOrder.set(it.order_id, [it]);
    }
    return orders.map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) || o.items || [],
    }));
  }

  /**
   * Single SQL scalar aggregate for window revenue (e.g. period-over-period comparison).
   */
  async sumRevenueInWindow(tenantId: string, startIso: string, endIso: string): Promise<number> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ sum: string }>(
        `SELECT coalesce(sum(grand_total), 0)::text AS sum FROM commerceos.orders
         WHERE tenant_id = $1 AND status != 'CANCELLED' AND created_at >= $2 AND created_at < $3`,
        [tenantId, startIso, endIso]
      );
      return Number(res.rows[0]?.sum ?? 0);
    }
    const from = new Date(startIso).getTime();
    const to = new Date(endIso).getTime();
    return db
      .getAllOrders(tenantId)
      .filter((o) => {
        const t = new Date(o.created_at).getTime();
        return t >= from && t < to && o.status !== "CANCELLED";
      })
      .reduce((sum, o) => sum + (o.grand_total || (o as any).total || 0), 0);
  }

  /**
   * Channel attribution aggregated in SQL GROUP BY, transferring only ~6 summary rows.
   */
  async getChannelAttribution(
    tenantId: string,
    startIso: string,
    endIso: string
  ): Promise<{
    tallies: Map<SalesChannel, { orders: number; gmv: number; shipped: number; rto: number; cod: number }>;
    total_gmv_bdt: number;
    total_orders_count: number;
  }> {
    const SHIPPED_STATUSES = new Set(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "RTO", "FAILED_DELIVERY"]);
    const RTO_STATUSES = new Set(["RETURNED", "RTO", "FAILED_DELIVERY"]);

    const tallies = new Map<SalesChannel, { orders: number; gmv: number; shipped: number; rto: number; cod: number }>();
    const channels: SalesChannel[] = ["WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM", "WEBSITE", "MANUAL_POS", "UNATTRIBUTED"];
    for (const c of channels) {
      tallies.set(c, { orders: 0, gmv: 0, shipped: 0, rto: 0, cod: 0 });
    }

    const client = this.getClient();
    if (client) {
      const sql = `
        SELECT
          CASE
            WHEN data->>'source' = 'WEBSITE' THEN 'WEBSITE'
            WHEN data->>'source' = 'MANUAL' THEN 'MANUAL_POS'
            WHEN data->>'source' = 'WHATSAPP' OR lower(coalesce(data->>'notes', '')) LIKE '%whatsapp%' THEN 'WHATSAPP'
            WHEN data->>'source' = 'INSTAGRAM' OR lower(coalesce(data->>'notes', '')) LIKE '%instagram%' THEN 'INSTAGRAM'
            WHEN data->>'source' = 'FACEBOOK' OR lower(coalesce(data->>'notes', '')) LIKE '%facebook%' OR lower(coalesce(data->>'notes', '')) LIKE '%messenger%' THEN 'FACEBOOK_MESSENGER'
            ELSE 'UNATTRIBUTED'
          END AS channel,
          count(*)::text AS orders,
          coalesce(sum(grand_total), 0)::text AS gmv,
          count(*) FILTER (WHERE data->>'payment_method' = 'COD')::text AS cod,
          count(*) FILTER (WHERE status IN ('SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'RTO', 'FAILED_DELIVERY'))::text AS shipped,
          count(*) FILTER (WHERE status IN ('RETURNED', 'RTO', 'FAILED_DELIVERY'))::text AS rto
        FROM commerceos.orders
        WHERE tenant_id = $1
          AND status != 'CANCELLED'
          AND created_at >= $2 AND created_at <= $3
        GROUP BY channel
      `;
      const res = await client.query<{
        channel: string;
        orders: string;
        gmv: string;
        cod: string;
        shipped: string;
        rto: string;
      }>(sql, [tenantId, startIso, endIso]);

      let totalGmv = 0;
      let totalOrders = 0;

      for (const row of res.rows) {
        const ch = (row.channel as SalesChannel) || "UNATTRIBUTED";
        const orders = Number(row.orders);
        const gmv = Number(row.gmv);
        const cod = Number(row.cod);
        const shipped = Number(row.shipped);
        const rto = Number(row.rto);

        tallies.set(ch, { orders, gmv, cod, shipped, rto });
        totalGmv += gmv;
        totalOrders += orders;
      }

      return { tallies, total_gmv_bdt: Math.round(totalGmv), total_orders_count: totalOrders };
    }

    // In-memory fallback
    const from = new Date(startIso).getTime();
    const to = new Date(endIso).getTime();
    const filtered = db.getAllOrders(tenantId).filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= from && t <= to && o.status !== "CANCELLED";
    });

    for (const o of filtered) {
      const ch = channelOfOrder(o);
      const t = tallies.get(ch) || { orders: 0, gmv: 0, shipped: 0, rto: 0, cod: 0 };
      t.orders += 1;
      t.gmv += o.grand_total;
      if (o.payment_method === "COD") t.cod += 1;
      if (SHIPPED_STATUSES.has(o.status)) t.shipped += 1;
      if (RTO_STATUSES.has(o.status)) t.rto += 1;
      tallies.set(ch, t);
    }

    const totalGmv = Math.round(filtered.reduce((acc, o) => acc + o.grand_total, 0));
    return { tallies, total_gmv_bdt: totalGmv, total_orders_count: filtered.length };
  }

  /**
   * Return-To-Origin (RTO) geography aggregated in SQL GROUP BY, transferring ~64 district rows.
   */
  async getRtoGeographyMetrics(
    tenantId: string
  ): Promise<Map<string, { shipped: number; delivered: number; rto: number; cod: number }>> {
    const stats = new Map<string, { shipped: number; delivered: number; rto: number; cod: number }>();
    const SHIPPED_STATUSES = new Set(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "RTO", "FAILED_DELIVERY"]);
    const RTO_STATUSES = new Set(["RETURNED", "RTO", "FAILED_DELIVERY"]);

    const client = this.getClient();
    if (client) {
      const sql = `
        SELECT
          data->'shipping_address_snapshot'->>'district' AS district,
          count(*)::text AS shipped,
          count(*) FILTER (WHERE status = 'DELIVERED')::text AS delivered,
          count(*) FILTER (WHERE status IN ('RETURNED', 'RTO', 'FAILED_DELIVERY'))::text AS rto,
          count(*) FILTER (WHERE data->>'payment_method' = 'COD')::text AS cod
        FROM commerceos.orders
        WHERE tenant_id = $1
          AND data->'shipping_address_snapshot'->>'district' IS NOT NULL
          AND coalesce(data->>'address_confidence', '') != 'UNKNOWN'
          AND status IN ('SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'RTO', 'FAILED_DELIVERY')
        GROUP BY data->'shipping_address_snapshot'->>'district'
      `;
      const res = await client.query<{
        district: string;
        shipped: string;
        delivered: string;
        rto: string;
        cod: string;
      }>(sql, [tenantId]);

      for (const row of res.rows) {
        if (!row.district) continue;
        stats.set(row.district, {
          shipped: Number(row.shipped),
          delivered: Number(row.delivered),
          rto: Number(row.rto),
          cod: Number(row.cod),
        });
      }
      return stats;
    }

    // In-memory fallback
    const orders = db.getAllOrders(tenantId);
    for (const order of orders) {
      const district = order.shipping_address_snapshot?.district;
      if (!district || order.address_confidence === "UNKNOWN" || !SHIPPED_STATUSES.has(order.status)) continue;
      const cur = stats.get(district) || { shipped: 0, delivered: 0, rto: 0, cod: 0 };
      cur.shipped += 1;
      if (order.status === "DELIVERED") cur.delivered += 1;
      if (RTO_STATUSES.has(order.status)) cur.rto += 1;
      if (order.payment_method === "COD") cur.cod += 1;
      stats.set(district, cur);
    }
    return stats;
  }

  /**
   * Customer-level order summary in single point query (for customer lifecycle & audience profiling).
   */
  async getCustomerOrderSummary(
    tenantId: string,
    customerId: string
  ): Promise<{
    orderCount: number;
    totalSpend: number;
    lastOrderAt?: string;
    firstOrderAt?: string;
    timestamps: number[];
  }> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{
        order_count: string;
        total_spend: string;
        last_order_at: string | null;
        first_order_at: string | null;
      }>(
        `SELECT
           count(*)::text AS order_count,
           coalesce(sum(grand_total), 0)::text AS total_spend,
           max(created_at) AS last_order_at,
           min(created_at) AS first_order_at
         FROM commerceos.orders
         WHERE tenant_id = $1 AND customer_id = $2 AND status != 'CANCELLED'`,
        [tenantId, customerId]
      );
      const row = res.rows[0];
      const count = Number(row?.order_count ?? 0);
      const spend = Number(row?.total_spend ?? 0);

      const tsRes = await client.query<{ created_at: string }>(
        `SELECT created_at FROM commerceos.orders
         WHERE tenant_id = $1 AND customer_id = $2 AND status != 'CANCELLED'
         ORDER BY created_at DESC`,
        [tenantId, customerId]
      );
      const timestamps = tsRes.rows.map((r) => new Date(r.created_at).getTime()).filter((t) => !isNaN(t));

      return {
        orderCount: count,
        totalSpend: Math.round(spend),
        lastOrderAt: row?.last_order_at || undefined,
        firstOrderAt: row?.first_order_at || undefined,
        timestamps,
      };
    }

    return this.getCustomerOrderSummarySync(tenantId, customerId);
  }

  getCustomerOrderSummarySync(
    tenantId: string,
    customerId: string
  ): {
    orderCount: number;
    totalSpend: number;
    lastOrderAt?: string;
    firstOrderAt?: string;
    timestamps: number[];
  } {
    const orders = db.getAllOrders(tenantId).filter((o) => o.customer_id === customerId && o.status !== "CANCELLED");
    const totalSpend = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const orderCount = orders.length;
    const timestamps = orders
      .map((o) => new Date(o.created_at).getTime())
      .filter((t) => !isNaN(t))
      .sort((a, b) => b - a);

    return {
      orderCount,
      totalSpend: Math.round(totalSpend),
      lastOrderAt: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : undefined,
      firstOrderAt: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : undefined,
      timestamps,
    };
  }

  /**
   * All customer order summaries grouped by customer in SQL.
   */
  async getAllCustomerOrderSummaries(
    tenantId: string
  ): Promise<Map<string, { orderCount: number; totalSpend: number; lastOrderAt?: string; firstOrderAt?: string; lastOrderChannel?: string }>> {
    const map = new Map<string, { orderCount: number; totalSpend: number; lastOrderAt?: string; firstOrderAt?: string; lastOrderChannel?: string }>();
    const client = this.getClient();
    if (client) {
      const res = await client.query<{
        customer_id: string;
        order_count: string;
        total_spend: string;
        last_order_at: string | null;
        first_order_at: string | null;
        last_order_channel: string | null;
      }>(
        `SELECT
           customer_id,
           count(*)::text AS order_count,
           coalesce(sum(grand_total), 0)::text AS total_spend,
           max(created_at) AS last_order_at,
           min(created_at) AS first_order_at,
           coalesce(max(data->>'source'), max(data->>'channel'), 'WEBSITE') AS last_order_channel
         FROM commerceos.orders
         WHERE tenant_id = $1 AND status != 'CANCELLED' AND customer_id IS NOT NULL
         GROUP BY customer_id`,
        [tenantId]
      );
      for (const r of res.rows) {
        if (!r.customer_id) continue;
        map.set(r.customer_id, {
          orderCount: Number(r.order_count),
          totalSpend: Number(r.total_spend),
          lastOrderAt: r.last_order_at || undefined,
          firstOrderAt: r.first_order_at || undefined,
          lastOrderChannel: r.last_order_channel || "WEBSITE",
        });
      }
      return map;
    }

    return this.getAllCustomerOrderSummariesSync(tenantId);
  }

  getAllCustomerOrderSummariesSync(
    tenantId: string
  ): Map<string, { orderCount: number; totalSpend: number; lastOrderAt?: string; firstOrderAt?: string; lastOrderChannel?: string }> {
    const map = new Map<string, { orderCount: number; totalSpend: number; lastOrderAt?: string; firstOrderAt?: string; lastOrderChannel?: string }>();
    const orders = db.getAllOrders(tenantId).filter((o) => o.status !== "CANCELLED");
    for (const o of orders) {
      if (!o.customer_id) continue;
      const cur = map.get(o.customer_id) || { orderCount: 0, totalSpend: 0, lastOrderAt: undefined, firstOrderAt: undefined, lastOrderChannel: "WEBSITE" };
      cur.orderCount += 1;
      cur.totalSpend += (o.grand_total || 0);
      if (!cur.lastOrderAt || o.created_at > cur.lastOrderAt) {
        cur.lastOrderAt = o.created_at;
        cur.lastOrderChannel = (o as any).source || (o as any).channel || "WEBSITE";
      }
      if (!cur.firstOrderAt || o.created_at < cur.firstOrderAt) cur.firstOrderAt = o.created_at;
      map.set(o.customer_id, cur);
    }
    return map;
  }

  /**
   * Order counts grouped by status.
   */
  async getOrderStatusCounts(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count FROM commerceos.orders WHERE tenant_id = $1 GROUP BY status`,
        [tenantId]
      );
      for (const r of res.rows) {
        counts[r.status] = Number(r.count);
      }
      return counts;
    }

    for (const o of db.getAllOrders(tenantId)) {
      counts[o.status] = (counts[o.status] || 0) + 1;
    }
    return counts;
  }

  /**
   * Product variant sales velocity over the last N days.
   */
  async getVariantSalesVelocity(tenantId: string, days = 30): Promise<Record<string, number>> {
    const velocity: Record<string, number> = {};
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ variant_id: string; quantity_sold: string }>(
        `SELECT
           oi.variant_id,
           coalesce(sum(oi.quantity), 0)::text AS quantity_sold
         FROM commerceos.order_items oi
         JOIN commerceos.orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         WHERE o.tenant_id = $1 AND o.status != 'CANCELLED' AND o.created_at >= $2
         GROUP BY oi.variant_id`,
        [tenantId, cutoffIso]
      );
      for (const r of res.rows) {
        if (r.variant_id) {
          velocity[r.variant_id] = Number(r.quantity_sold);
        }
      }
      return velocity;
    }

    const cutoff = Date.now() - days * 86400000;
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const recent = orders.filter((o) => new Date(o.created_at).getTime() >= cutoff && o.status !== "CANCELLED");
    for (const o of recent) {
      for (const it of o.items || []) {
        const vId = it.variant_id || (it as any).product_variant_id;
        if (vId) {
          velocity[vId] = (velocity[vId] || 0) + it.quantity;
        }
      }
    }
    return velocity;
  }

  /**
   * Sum of delivered COD orders with unreconciled payment status.
   */
  async getUnreconciledCodTotal(tenantId: string): Promise<number> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ total: string }>(
        `SELECT coalesce(sum(grand_total), 0)::text AS total FROM commerceos.orders
         WHERE tenant_id = $1 AND status = 'DELIVERED' AND data->>'payment_method' = 'COD' AND payment_status != 'PAID'`,
        [tenantId]
      );
      return Number(res.rows[0]?.total ?? 0);
    }
    const orders = db.getAllOrders(tenantId);
    return orders
      .filter((o) => o.status === "DELIVERED" && o.payment_method === "COD" && o.payment_status !== "PAID")
      .reduce((sum, o) => sum + (o.grand_total || (o as any).total_amount || 0), 0);
  }

  /**
   * Average order value over last N days (sync).
   */
  getAov(tenantId: string, days = 90): { aov: number | null; count: number } {
    const cutoff = Date.now() - days * 86400000;
    const recent = db.getAllOrders(tenantId).filter((o) => o.status !== "CANCELLED" && Date.parse(o.created_at) >= cutoff);
    const count = recent.length;
    const aov = count > 0 ? recent.reduce((sum, o) => sum + o.grand_total, 0) / count : null;
    return { aov, count };
  }

  /**
   * Average order value over last N days (async SQL).
   */
  async getAovAsync(tenantId: string, days = 90): Promise<{ aov: number | null; count: number }> {
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ aov: string; count: string }>(
        `SELECT
           coalesce(avg(grand_total), 0)::text AS aov,
           count(*)::text AS count
         FROM commerceos.orders
         WHERE tenant_id = $1 AND status != 'CANCELLED' AND created_at >= $2`,
        [tenantId, cutoffIso]
      );
      const count = Number(res.rows[0]?.count ?? 0);
      const aov = count > 0 ? Number(res.rows[0]?.aov ?? 0) : null;
      return { aov, count };
    }
    return this.getAov(tenantId, days);
  }

  /**
   * Count of delivered orders since N days ago.
   */
  async countDeliveredSince(tenantId: string, days = 7): Promise<number> {
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM commerceos.orders
         WHERE tenant_id = $1 AND status = 'DELIVERED' AND row_updated_at >= $2`,
        [tenantId, cutoffIso]
      );
      return Number(res.rows[0]?.count ?? 0);
    }
    const cutoff = Date.now() - days * 86400000;
    return db
      .getAllOrders(tenantId)
      .filter((o) => o.status === "DELIVERED" && Date.parse(o.updated_at) >= cutoff).length;
  }

  /**
   * Sales overview for SalesIntelligenceService.
   */
  async getSalesOverview(tenantId: string, days = 30): Promise<{
    totalRevenue: number;
    totalOrders: number;
    channelMap: Record<string, { revenue: number; orders: number }>;
  }> {
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    const client = this.getClient();
    if (client) {
      const sumRes = await client.query<{ total_revenue: string; total_orders: string }>(
        `SELECT
           coalesce(sum(grand_total), 0)::text AS total_revenue,
           count(*)::text AS total_orders
         FROM commerceos.orders
         WHERE tenant_id = $1 AND status != 'CANCELLED' AND created_at >= $2`,
        [tenantId, cutoffIso]
      );
      const chRes = await client.query<{ channel: string; revenue: string; orders: string }>(
        `SELECT
           coalesce(data->>'channel', data->>'source', 'WEBSITE') AS channel,
           coalesce(sum(grand_total), 0)::text AS revenue,
           count(*)::text AS orders
         FROM commerceos.orders
         WHERE tenant_id = $1 AND status != 'CANCELLED' AND created_at >= $2
         GROUP BY coalesce(data->>'channel', data->>'source', 'WEBSITE')`,
        [tenantId, cutoffIso]
      );
      const channelMap: Record<string, { revenue: number; orders: number }> = {};
      for (const r of chRes.rows) {
        channelMap[r.channel] = { revenue: Number(r.revenue), orders: Number(r.orders) };
      }
      return {
        totalRevenue: Number(sumRes.rows[0]?.total_revenue ?? 0),
        totalOrders: Number(sumRes.rows[0]?.total_orders ?? 0),
        channelMap,
      };
    }

    const cutoff = Date.now() - days * 86400000;
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const periodOrders = orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= cutoff && o.status !== "CANCELLED";
    });
    const totalRevenue = periodOrders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const channelMap: Record<string, { revenue: number; orders: number }> = {};
    for (const o of periodOrders) {
      const ch = (o as any).source || (o as any).channel || "WEBSITE";
      if (!channelMap[ch]) channelMap[ch] = { revenue: 0, orders: 0 };
      const amt = (o as any).grand_total || (o as any).total_amount || 0;
      channelMap[ch].revenue += amt;
      channelMap[ch].orders += 1;
    }
    return {
      totalRevenue,
      totalOrders: periodOrders.length,
      channelMap,
    };
  }

  /**
   * Find unfulfilled orders (CONFIRMED or PROCESSING) for SLA evaluation.
   */
  async findUnfulfilledOrders(tenantId: string): Promise<Order[]> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ data: Order | string }>(
        `SELECT data FROM commerceos.orders
         WHERE tenant_id = $1 AND status IN ('CONFIRMED', 'PROCESSING')
         ORDER BY created_at ASC`,
        [tenantId]
      );
      return res.rows.map((r) => parseJsonData<Order>(r.data));
    }
    return this.findUnfulfilledOrdersSync(tenantId);
  }

  findUnfulfilledOrdersSync(tenantId: string): Order[] {
    return db.getAllOrders(tenantId).filter((o) => o.status === "CONFIRMED" || o.status === "PROCESSING");
  }

  /**
   * Keyset (Cursor) Pagination for Orders.
   * Avoids scanning and discarding rows; queries index (created_at DESC, id DESC).
   */
  async listWithCursor(
    tenantId: string,
    options?: {
      status?: string;
      payment_status?: string;
      customer_id?: string;
      search?: string;
      limit?: number;
      cursor?: string;
    }
  ): Promise<CursorPaginatedResult<Order>> {
    const limit = options?.limit ?? 20;
    const client = this.getClient();

    if (!client) {
      let list = db.getAllOrders(tenantId);
      if (options?.status) {
        list = list.filter((o) => o.status === options.status);
      }
      if (options?.payment_status) {
        list = list.filter((o) => o.payment_status === options.payment_status);
      }
      if (options?.customer_id) {
        list = list.filter((o) => o.customer_id === options.customer_id);
      }
      if (options?.search) {
        const q = options.search.toLowerCase().trim();
        list = list.filter(
          (o) =>
            o.order_number.toLowerCase().includes(q) ||
            (o as any).customer_phone?.includes(q) ||
            (o as any).customer_name?.toLowerCase().includes(q)
        );
      }
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return sliceForCursor(list, limit, options?.cursor);
    }

    const params: unknown[] = [tenantId];
    let whereSQL = `tenant_id = $1`;
    let nextIdx = 2;

    if (options?.status) {
      whereSQL += ` AND status = $${nextIdx++}`;
      params.push(options.status);
    }
    if (options?.payment_status) {
      whereSQL += ` AND payment_status = $${nextIdx++}`;
      params.push(options.payment_status);
    }
    if (options?.customer_id) {
      whereSQL += ` AND customer_id = $${nextIdx++}`;
      params.push(options.customer_id);
    }
    if (options?.search) {
      whereSQL += ` AND (order_number ILIKE $${nextIdx} OR data->>'notes' ILIKE $${nextIdx})`;
      params.push(`%${options.search}%`);
      nextIdx++;
    }

    const decoded = decodeCursor(options?.cursor);
    const keyset = buildKeysetClause(decoded, nextIdx);
    whereSQL += keyset.sqlClause;
    params.push(...keyset.params);
    nextIdx = keyset.nextParamIndex;

    const fetchLimit = limit + 1;
    const querySQL = `
      SELECT id, created_at, data
      FROM commerceos.orders
      WHERE ${whereSQL}
      ORDER BY created_at DESC, id DESC
      LIMIT $${nextIdx}
    `;
    params.push(fetchLimit);

    const rowsRes = await client.query<{ id: string; created_at: string; data: Order | string }>(
      querySQL,
      params
    );
    const rows = rowsRes.rows;

    const hasMore = rows.length > limit;
    const pagedRows = hasMore ? rows.slice(0, limit) : rows;

    const orderIds = pagedRows.map((r) => r.id);
    const itemsMap = new Map<string, OrderItem[]>();

    if (orderIds.length > 0) {
      const itemRows = await client.query<{ order_id: string; data: OrderItem | string }>(
        `SELECT order_id, data FROM commerceos.order_items WHERE tenant_id = $1 AND order_id = ANY($2::text[])`,
        [tenantId, orderIds]
      );
      for (const ir of itemRows.rows) {
        const list = itemsMap.get(ir.order_id) || [];
        list.push(parseJsonData<OrderItem>(ir.data));
        itemsMap.set(ir.order_id, list);
      }
    }

    const orders: Order[] = pagedRows.map((r) => {
      const data = parseJsonData<Order>(r.data);
      return {
        ...data,
        subtotal: Number(data.subtotal || 0),
        shipping_total: Number(data.shipping_total || (data as any).delivery_charge || 0),
        discount_total: Number(data.discount_total || (data as any).discount || 0),
        grand_total: Number(data.grand_total || (data as any).total || 0),
        items: itemsMap.get(r.id) || data.items || [],
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pagedRows.length > 0) {
      const last = pagedRows[pagedRows.length - 1];
      const lastCreatedAt = last.created_at || (parseJsonData<Order>(last.data) as any)?.created_at || new Date().toISOString();
      nextCursor = encodeCursor(lastCreatedAt, last.id);
    }

    return {
      items: orders,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
    };
  }

  async listOrders(
    tenantId: string,
    options?: {
      status?: string;
      payment_status?: string;
      customer_id?: string;
      search?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    }
  ): Promise<{
    orders: Order[];
    total: number;
    next_cursor?: string | null;
    has_more?: boolean;
  }> {
    if (options?.cursor !== undefined) {
      const cursorRes = await this.listWithCursor(tenantId, options);
      return {
        orders: cursorRes.items,
        total: cursorRes.total ?? cursorRes.items.length,
        next_cursor: cursorRes.pagination.next_cursor,
        has_more: cursorRes.pagination.has_more,
      };
    }

    const res = db.getOrders(tenantId, {
      status: options?.status,
      payment_status: options?.payment_status,
      customer_id: options?.customer_id,
      search: options?.search,
      limit: options?.limit ?? 50,
      offset: options?.offset,
    });

    return {
      orders: res.orders as any,
      total: res.total,
    };
  }

  async createOrder(order: Order, items?: OrderItem[]): Promise<Order> {
    const orderItems = items || order.items || [];
    return db.createOrder(order, orderItems);
  }

  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    status: OrderStatus,
    tx?: SqlExecutor
  ): Promise<Order | null> {
    const executor = tx || this.getClient();
    if (executor) {
      const res = await executor.query<{ data: Order | string }>(
        `UPDATE commerceos.orders
         SET data = jsonb_set(data, '{status}', to_jsonb($3::text)),
             row_updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING data`,
        [tenantId, orderId, status]
      );
      const row = res.rows[0];
      if (row?.data) {
        const updated = parseJsonData<Order>(row.data);
        if (db.data?.orders && Array.isArray(db.data.orders)) {
          const idx = db.data.orders.findIndex((o) => o.tenant_id === tenantId && o.id === orderId);
          if (idx !== -1) {
            db.data.orders[idx].status = status;
            db.data.orders[idx].updated_at = new Date().toISOString();
          }
        }
        return updated;
      }
    }
    return db.updateOrderStatus(tenantId, orderId, status) || null;
  }

  /**
   * Semantic repository mutation for updating an order (Phase D - Write-Path Decoupling).
   * Executes parameterized atomic UPDATE with optional optimistic concurrency control via version.
   */
  async update(
    tenantId: string,
    orderId: string,
    updates: Partial<Order>,
    options?: { expectedVersion?: number; tx?: SqlExecutor }
  ): Promise<Order | null> {
    const executor = options?.tx || this.getClient();
    if (executor) {
      let sql = `UPDATE commerceos.orders
                 SET data = data || $3::jsonb,
                     version = version + 1,
                     row_updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`;
      const params: unknown[] = [tenantId, orderId, JSON.stringify(updates)];
      if (options?.expectedVersion !== undefined) {
        sql += ` AND version = $4`;
        params.push(options.expectedVersion);
      }
      sql += ` RETURNING data, version::text AS version`;

      const res = await executor.query<{ data: Order | string; version: string }>(sql, params);
      if (res.rowCount === 0) {
        if (options?.expectedVersion !== undefined) {
          const check = await executor.query<{ version: string }>(
            `SELECT version::text AS version FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
            [tenantId, orderId]
          );
          if (check.rowCount && check.rows[0].version !== String(options.expectedVersion)) {
            throw new StoreConflictError([{ collection: "orders", id: orderId }]);
          }
        }
        return null;
      }
      const updated = parseJsonData<Order>(res.rows[0].data);
      if (db.isCollectionHydrated("orders")) {
        const idx = db.data.orders.findIndex((o) => o.tenant_id === tenantId && o.id === orderId);
        if (idx !== -1) {
          db.data.orders[idx] = { ...db.data.orders[idx], ...updates, updated_at: new Date().toISOString() };
        }
      }
      return updated;
    }

    // In-memory fallback
    const memOrder = db.findOrderById(tenantId, orderId);
    if (!memOrder) return null;
    Object.assign(memOrder, updates, { updated_at: new Date().toISOString() });
    return memOrder;
  }

  /**
   * Anonymizes customer PII across all orders for a tenant & customer (customer erasure).
   * Strips shipping and billing address snapshots down to district/division/area/upazila/country.
   * Removes order notes.
   * Preserves totals, amounts, items, and order status.
   */
  async anonymizeCustomerReferences(
    tenantId: string,
    customerId: string,
    tx?: SqlExecutor
  ): Promise<number> {
    const executor = tx || this.getClient();
    let redactedCount = 0;

    if (executor) {
      const res = await executor.query<{ id: string }>(
        `UPDATE commerceos.orders
         SET data = jsonb_set(
           jsonb_set(
             data - 'notes',
             '{shipping_address_snapshot}',
             CASE 
               WHEN data ? 'shipping_address_snapshot' AND data->'shipping_address_snapshot' IS NOT NULL THEN
                 jsonb_strip_nulls(jsonb_build_object(
                   'district', data->'shipping_address_snapshot'->'district',
                   'division', data->'shipping_address_snapshot'->'division',
                   'area', data->'shipping_address_snapshot'->'area',
                   'upazila', data->'shipping_address_snapshot'->'upazila',
                   'country', data->'shipping_address_snapshot'->'country'
                 ))
               ELSE 'null'::jsonb
             END
           ),
           '{billing_address_snapshot}',
           CASE 
             WHEN data ? 'billing_address_snapshot' AND data->'billing_address_snapshot' IS NOT NULL THEN
               jsonb_strip_nulls(jsonb_build_object(
                 'district', data->'billing_address_snapshot'->'district',
                 'division', data->'billing_address_snapshot'->'division',
                 'area', data->'billing_address_snapshot'->'area',
                 'upazila', data->'billing_address_snapshot'->'upazila',
                 'country', data->'billing_address_snapshot'->'country'
               ))
             ELSE 'null'::jsonb
           END
         ) - (CASE WHEN data ? 'billing_address_snapshot' AND data->'billing_address_snapshot' IS NOT NULL THEN '' ELSE 'billing_address_snapshot' END),
         row_updated_at = now()
         WHERE tenant_id = $1 AND customer_id = $2
         RETURNING id`,
        [tenantId, customerId]
      );
      redactedCount = res.rowCount;
    }

    // Also sanitize in-memory orders if memory store is active (dual-mode / fallback)
    if (db.data?.orders && Array.isArray(db.data.orders)) {
      let memCount = 0;
      for (const o of db.data.orders) {
        if (o.tenant_id !== tenantId || o.customer_id !== customerId) continue;
        const strip = (a: Record<string, unknown> | undefined) =>
          a ? { district: a.district, division: a.division, area: a.area, upazila: a.upazila, country: a.country } : a;
        o.shipping_address_snapshot = strip(o.shipping_address_snapshot as Record<string, unknown>) as typeof o.shipping_address_snapshot;
        if (o.billing_address_snapshot) {
          o.billing_address_snapshot = strip(o.billing_address_snapshot as Record<string, unknown>) as typeof o.billing_address_snapshot;
        }
        delete (o as { notes?: string }).notes;
        memCount++;
      }
      if (!executor) redactedCount = memCount;
    }

    return redactedCount;
  }

  /**
   * Bounded cursor iteration over orders for batch/analytics workloads (ADR-109, Phase D).
   * Streams orders in chunks without loading all orders into Node.js memory.
   */
  async *iterateByCursor(
    tenantId: string,
    options?: { batchSize?: number; status?: OrderStatus }
  ): AsyncIterable<Order[]> {
    const limit = Math.min(Math.max(options?.batchSize ?? 100, 1), 1000);
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const page = await this.listWithCursor(tenantId, {
        limit,
        cursor: cursor ?? undefined,
        status: options?.status,
      });

      if (page.items.length > 0) {
        yield page.items;
      }

      cursor = page.pagination.next_cursor;
      hasMore = page.pagination.has_more && Boolean(cursor);
    }
  }

  /**
   * Database-native daily volume and revenue aggregates for anomaly detection, forecasting, and time-series.
   * Avoids loading orders into Node.js heap.
   */
  async getDailyOrderMetrics(
    tenantId: string,
    days = 30
  ): Promise<Array<{ day: string; count: number; revenue: number }>> {
    const client = this.getClient();
    if (!client) {
      if (!db.isCollectionHydrated("orders")) return [];
      const cutoff = Date.now() - days * 86400000;
      const dailyMap: Record<string, { count: number; revenue: number }> = {};
      const orders = (db.data.orders || []).filter(
        (o) => o.tenant_id === tenantId && o.status !== "CANCELLED" && Date.parse(o.created_at) >= cutoff
      );
      for (const o of orders) {
        const d = (o.created_at || "").slice(0, 10);
        if (!d) continue;
        if (!dailyMap[d]) dailyMap[d] = { count: 0, revenue: 0 };
        dailyMap[d].count += 1;
        dailyMap[d].revenue += o.grand_total || 0;
      }
      return Object.entries(dailyMap)
        .map(([day, val]) => ({ day, ...val }))
        .sort((a, b) => a.day.localeCompare(b.day));
    }

    const res = await client.query<{ day: string; count: string; revenue: string }>(
      `SELECT
         to_char(created_at, 'YYYY-MM-DD') AS day,
         count(*)::text AS count,
         coalesce(sum((data->>'grand_total')::numeric), 0)::text AS revenue
       FROM commerceos.orders
       WHERE tenant_id = $1
         AND status <> 'CANCELLED'
         AND created_at >= now() - ($2::text || ' days')::interval
       GROUP BY to_char(created_at, 'YYYY-MM-DD')
       ORDER BY day ASC`,
      [tenantId, String(days)]
    );

    return res.rows.map((r) => ({
      day: r.day,
      count: Number(r.count || 0),
      revenue: Number(r.revenue || 0),
    }));
  }
}

export const orderRepository = new OrderRepository();
