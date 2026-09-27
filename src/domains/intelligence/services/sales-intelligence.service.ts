/**
 * CommerceOS Phase 6: Sales Intelligence Service
 * Multi-channel performance, regional breakdowns, and revenue velocity analysis.
 */

import { db } from "@/infrastructure/db";

export interface SalesChannelBreakdown {
  channel: string;
  revenue: number;
  orders: number;
  share_pct: number;
}

export interface RegionalSalesBreakdown {
  region: string;
  revenue: number;
  orders: number;
  share_pct: number;
}

export interface SalesIntelligenceOverview {
  tenant_id: string;
  period_days: number;
  total_revenue_bdt: number;
  total_orders: number;
  daily_sales_velocity_bdt: number;
  channels: SalesChannelBreakdown[];
  regions: RegionalSalesBreakdown[];
  payment_methods: Array<{ method: string; count: number; total_bdt: number }>;
  generated_at: string;
}

export class SalesIntelligenceService {
  /**
   * Generates a comprehensive sales performance overview for a tenant
   */
  public getOverview(tenantId: string, days: number = 30): SalesIntelligenceOverview {
    const orders = db.getOrders(tenantId).orders;
    const cutoff = new Date(Date.now() - days * 86400000).getTime();

    const periodOrders = orders.filter((o: any) => {
      const t = new Date(o.created_at).getTime();
      return t >= cutoff && o.status !== "CANCELLED";
    });

    const totalRevenue = periodOrders.reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0);
    const totalOrders = periodOrders.length;
    const velocity = Number((totalRevenue / Math.max(days, 1)).toFixed(2));

    // Channel breakdown
    const channelMap: Record<string, { revenue: number; orders: number }> = {};
    for (const o of periodOrders) {
      const ch = (o as any).source || (o as any).channel || "WEBSITE";
      if (!channelMap[ch]) channelMap[ch] = { revenue: 0, orders: 0 };
      const amt = (o as any).grand_total || (o as any).total_amount || 0;
      channelMap[ch].revenue += amt;
      channelMap[ch].orders += 1;
    }

    const channels: SalesChannelBreakdown[] = Object.entries(channelMap).map(([ch, v]) => ({
      channel: ch,
      revenue: Number(v.revenue.toFixed(2)),
      orders: v.orders,
      share_pct: totalRevenue > 0 ? Number(((v.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }));

    // Regional breakdown
    const regionMap: Record<string, { revenue: number; orders: number }> = {};
    for (const o of periodOrders) {
      const reg =
        (o as any).shipping_address_snapshot?.district ||
        (o as any).shipping_address_snapshot?.city ||
        (o as any).shipping_address?.district ||
        "Dhaka";
      if (!regionMap[reg]) regionMap[reg] = { revenue: 0, orders: 0 };
      const amt = (o as any).grand_total || (o as any).total_amount || 0;
      regionMap[reg].revenue += amt;
      regionMap[reg].orders += 1;
    }

    const regions: RegionalSalesBreakdown[] = Object.entries(regionMap).map(([reg, v]) => ({
      region: reg,
      revenue: Number(v.revenue.toFixed(2)),
      orders: v.orders,
      share_pct: totalRevenue > 0 ? Number(((v.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }));

    // Payment methods
    const payments = db.getPayments(tenantId);
    const payMap: Record<string, { count: number; total: number }> = {};
    for (const p of payments) {
      const m = p.provider || "COD";
      if (!payMap[m]) payMap[m] = { count: 0, total: 0 };
      payMap[m].count += 1;
      payMap[m].total += p.amount || 0;
    }

    const paymentMethods = Object.entries(payMap).map(([m, v]) => ({
      method: m,
      count: v.count,
      total_bdt: Number(v.total.toFixed(2)),
    }));

    return {
      tenant_id: tenantId,
      period_days: days,
      total_revenue_bdt: Number(totalRevenue.toFixed(2)),
      total_orders: totalOrders,
      daily_sales_velocity_bdt: velocity,
      channels,
      regions,
      payment_methods: paymentMethods,
      generated_at: new Date().toISOString(),
    };
  }
}

export const salesIntelligenceService = new SalesIntelligenceService();
