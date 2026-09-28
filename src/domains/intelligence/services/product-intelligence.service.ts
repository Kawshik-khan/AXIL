/**
 * CommerceOS Phase 6: Product Intelligence Service
 * SKU velocity, transparent performance scoring, and catalog lifecycle categorization.
 */

import { db } from "@/infrastructure/db";
import { ProductPerformanceSnapshot } from "@/types/intelligence";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class ProductIntelligenceService {
  /**
   * Computes product performance snapshots for all products in a tenant and stores them (one write).
   */
  public analyzeProductPerformance(tenantId: string): ProductPerformanceSnapshot[] {
    const snapshots = this.computeProductPerformance(tenantId);
    intelligenceSnapshots.persist(tenantId, "products", snapshots);
    return snapshots;
  }

  /** Pure (FX-21): product performance snapshots, best first. */
  public computeProductPerformance(tenantId: string): ProductPerformanceSnapshot[] {
    const products = db.getAllProducts(tenantId); // variants attached through a map (FX-23)
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const returns = db.getReturns(tenantId);

    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recentOrders = orders.filter(
      (o) => new Date(o.created_at).getTime() >= thirtyDaysAgo && o.status !== "CANCELLED"
    );

    // Aggregate units sold & revenue per product
    const productStats: Record<
      string,
      { units: number; revenue: number; ordersCount: number }
    > = {};

    for (const order of recentOrders) {
      const items = (order as any).items || [];
      for (const item of items) {
        const prodId = item.product_id;
        if (prodId) {
          if (!productStats[prodId]) {
            productStats[prodId] = { units: 0, revenue: 0, ordersCount: 0 };
          }
          productStats[prodId].units += item.quantity || 1;
          productStats[prodId].revenue += (item.unit_price || 0) * (item.quantity || 1);
          productStats[prodId].ordersCount += 1;
        }
      }
    }

    const snapshots: ProductPerformanceSnapshot[] = [];

    for (const prod of products) {
      const stats = productStats[prod.id] || { units: 0, revenue: 0, ordersCount: 0 };
      const prodVariants = prod.variants ?? [];
      const sku = prodVariants[0]?.sku || prod.slug || "SKU-UNKNOWN";

      // Calculate transparent 100-point performance score
      // Formula: Velocity (40pts) + Margin (30pts) + Order Consistency (20pts) - Penalty (10pts)
      const velocityPoints = Math.min(stats.units * 4, 40); // 10 units sold = 40 pts
      const grossMarginPct = 40.0; // Standard retail margin
      const marginPoints = Math.min((grossMarginPct / 50) * 30, 30);
      const consistencyPoints = Math.min(stats.ordersCount * 2, 20);

      // Return rate penalty
      const prodReturns = returns.filter((r) => r.tenant_id === tenantId);
      const returnRate = stats.ordersCount > 0 ? (prodReturns.length / stats.ordersCount) * 100 : 0;
      const penaltyPoints = returnRate > 10 ? 10 : returnRate > 5 ? 5 : 0;

      const score = Math.max(0, Math.min(100, Math.round(velocityPoints + marginPoints + consistencyPoints - penaltyPoints)));

      let statusTag: "BEST_SELLER" | "EMERGING" | "STEADY" | "SLOW_MOVING" | "DECLINING" = "STEADY";
      if (score >= 75) statusTag = "BEST_SELLER";
      else if (score >= 55) statusTag = "EMERGING";
      else if (score >= 35) statusTag = "STEADY";
      else if (stats.units === 0) statusTag = "DECLINING";
      else statusTag = "SLOW_MOVING";

      const snapshot: ProductPerformanceSnapshot = {
        id: `pp_${prod.id}_${tenantId}`,
        tenant_id: tenantId,
        product_id: prod.id,
        product_name: prod.name,
        sku,
        units_sold_30d: stats.units,
        revenue_bdt_30d: Number(stats.revenue.toFixed(2)),
        gross_margin_pct: grossMarginPct,
        return_rate_pct: Number(returnRate.toFixed(1)),
        cancellation_rate_pct: 0,
        performance_score: score,
        score_breakdown: {
          sales_velocity_points: velocityPoints,
          margin_points: marginPoints,
          retention_points: consistencyPoints,
          penalty_points: penaltyPoints,
        },
        status_tag: statusTag,
        computed_at: new Date().toISOString(),
      };

      snapshots.push(snapshot);
    }

    return snapshots.sort((a, b) => b.performance_score - a.performance_score);
  }
}

export const productIntelligenceService = new ProductIntelligenceService();
