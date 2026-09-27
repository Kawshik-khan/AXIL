/**
 * CommerceOS Phase 6: Inventory Intelligence Service
 * Demand velocity, stockout risk forecasting, days of inventory, and deterministic reorder quantities.
 */

import { db } from "@/infrastructure/db";
import { InventoryIntelligenceSnapshot } from "@/types/intelligence";

export class InventoryIntelligenceService {
  /**
   * Evaluates inventory intelligence across all tenant product variants
   */
  public analyzeInventoryHealth(tenantId: string): InventoryIntelligenceSnapshot[] {
    const variants = db.getAllProductVariants(tenantId);
    const products = db.getProducts(tenantId).products;
    const inventory = db.getInventory(tenantId);
    const orders = db.getOrders(tenantId).orders;

    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recentOrders = orders.filter(
      (o) => new Date(o.created_at).getTime() >= thirtyDaysAgo && o.status !== "CANCELLED"
    );

    // Calculate 30-day unit demand per variant
    const variantDemand: Record<string, number> = {};
    for (const o of recentOrders) {
      const items = (o as any).items || [];
      for (const item of items) {
        const vId = item.product_variant_id || item.variant_id;
        if (vId) {
          variantDemand[vId] = (variantDemand[vId] || 0) + (item.quantity || 1);
        }
      }
    }

    const snapshots: InventoryIntelligenceSnapshot[] = [];

    for (const v of variants) {
      const prod = products.find((p) => p.id === v.product_id);
      const invItems = inventory.filter((i) => i.product_variant_id === v.id);

      const currentStock = invItems.reduce((acc, i) => acc + i.quantity_on_hand, 0);
      const reservedStock = invItems.reduce((acc, i) => acc + i.quantity_reserved, 0);
      const availableStock = invItems.reduce((acc, i) => acc + i.quantity_available, 0);

      const demand30d = variantDemand[v.id] || 0;
      const dailyDemand = Number((demand30d / 30).toFixed(2));

      // Calculate days of inventory remaining
      const effectiveDailyDemand = dailyDemand > 0 ? dailyDemand : 0.05; // avoid divide-by-zero
      const daysRemaining = Number((availableStock / effectiveDailyDemand).toFixed(1));

      // Stockout risk
      let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
      if (availableStock <= 0 || daysRemaining <= 3) riskLevel = "CRITICAL";
      else if (daysRemaining <= 7) riskLevel = "HIGH";
      else if (daysRemaining <= 14) riskLevel = "MEDIUM";

      // Projected stockout date
      let projectedDate: string | undefined = undefined;
      if (dailyDemand > 0 && availableStock > 0) {
        projectedDate = new Date(Date.now() + daysRemaining * 86400000).toISOString().slice(0, 10);
      }

      // Reorder quantity calculation: (Daily Demand * 7 days lead) + (Daily Demand * 5 days safety) - Available
      const leadTimeDays = 7;
      const safetyStockUnits = Math.max(5, Math.ceil(dailyDemand * 5));
      const neededStock = Math.ceil(dailyDemand * leadTimeDays) + safetyStockUnits;
      const recommendedReorder = Math.max(0, neededStock - availableStock);

      const isDeadStock = currentStock > 0 && demand30d === 0;

      const snapshot: InventoryIntelligenceSnapshot = {
        id: `inv_intel_${v.id}_${tenantId}`,
        tenant_id: tenantId,
        variant_id: v.id,
        product_name: prod ? `${prod.name} (${v.title || v.sku})` : v.sku,
        sku: v.sku,
        current_stock: currentStock,
        reserved_stock: reservedStock,
        available_stock: availableStock,
        average_daily_demand_30d: dailyDemand,
        days_of_inventory_remaining: daysRemaining,
        projected_stockout_date: projectedDate,
        recommended_reorder_qty: recommendedReorder,
        safety_stock_units: safetyStockUnits,
        stockout_risk_level: riskLevel,
        is_dead_stock: isDeadStock,
        computed_at: new Date().toISOString(),
      };

      db.upsertInventoryIntelligence(snapshot);
      snapshots.push(snapshot);
    }

    return snapshots;
  }
}

export const inventoryIntelligenceService = new InventoryIntelligenceService();
