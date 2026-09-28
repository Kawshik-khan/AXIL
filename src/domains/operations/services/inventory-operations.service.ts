/**
 * CommerceOS Phase 8: Autonomous Inventory Operations Service
 * Continuous stock monitoring, low-stock risk prediction, safety stock optimization,
 * multi-warehouse transfer proposals, and reconciliation discrepancy detection.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { InventoryItem } from "@/types/commerce";

export interface StockoutRiskAssessment {
  variant_id: string;
  product_variant_id?: string;
  sku: string;
  product_name: string;
  warehouse_id: string;
  current_available: number;
  daily_sales_velocity: number;
  days_of_supply_remaining: number;
  safety_stock_level: number;
  risk_level: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommended_reorder_quantity: number;
}

export interface WarehouseTransferRecommendation {
  source_warehouse_id: string;
  source_warehouse_name: string;
  target_warehouse_id: string;
  target_warehouse_name: string;
  product_variant_id: string;
  sku: string;
  recommended_transfer_quantity: number;
  reason: string;
  estimated_transit_hours: number;
}

export class InventoryOperationsService {
  /**
   * Scans all warehouse inventories and evaluates forward stockout risk
   */
  public evaluateStockoutRisks(tenantId: string): StockoutRiskAssessment[] {
    const inventory = db.getInventory(tenantId);
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const assessments: StockoutRiskAssessment[] = [];

    // Calculate 30-day velocity from completed/confirmed orders
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recentOrders = orders.filter((o) => new Date(o.created_at).getTime() >= thirtyDaysAgo && o.status !== "CANCELLED");

    const variantVelocity: Record<string, number> = {};
    for (const order of recentOrders) {
      const items = order.items ?? []; // already hydrated: no per-order scan of all order items (FX-23)
      for (const item of items) {
        const vId = item.variant_id || (item as any).product_variant_id;
        variantVelocity[vId] = (variantVelocity[vId] || 0) + item.quantity;
      }
    }

    for (const inv of inventory) {
      const totalUnitsSold30d = variantVelocity[inv.product_variant_id] || 0;
      const dailyVelocity = totalUnitsSold30d > 0 ? Number((totalUnitsSold30d / 30).toFixed(2)) : 0.5; // fallback default
      const daysRemaining = dailyVelocity > 0 ? Math.floor(inv.quantity_available / dailyVelocity) : 999;
      const safetyStock = inv.reorder_point || 10;

      let riskLevel: StockoutRiskAssessment["risk_level"] = "NONE";
      if (inv.quantity_available <= 0) {
        riskLevel = "CRITICAL";
      } else if (daysRemaining <= 3 || inv.quantity_available < safetyStock * 0.5) {
        riskLevel = "HIGH";
      } else if (daysRemaining <= 7 || inv.quantity_available <= safetyStock) {
        riskLevel = "MEDIUM";
      } else if (daysRemaining <= 14) {
        riskLevel = "LOW";
      }

      const targetSupplyDays = 30;
      const neededQty = Math.max(0, Math.ceil(dailyVelocity * targetSupplyDays) - inv.quantity_available);

      assessments.push({
        variant_id: inv.product_variant_id,
        product_variant_id: inv.product_variant_id,
        sku: inv.sku || "SKU-UNKNOWN",
        product_name: inv.product_name || "Catalog Product",
        warehouse_id: inv.warehouse_id,
        current_available: inv.quantity_available,
        daily_sales_velocity: dailyVelocity,
        days_of_supply_remaining: daysRemaining,
        safety_stock_level: safetyStock,
        risk_level: riskLevel,
        recommended_reorder_quantity: Math.max(neededQty, 20),
      });
    }

    return assessments.sort((a, b) => {
      const severity = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };
      return severity[b.risk_level] - severity[a.risk_level];
    });
  }

  /**
   * Identifies balancing opportunities across multiple warehouses
   */
  public evaluateWarehouseTransfers(tenantId: string): WarehouseTransferRecommendation[] {
    const warehouses = db.getWarehouses(tenantId);
    if (warehouses.length < 2) return [];

    const inventory = db.getInventory(tenantId);
    const recommendations: WarehouseTransferRecommendation[] = [];

    // Group inventory by variant
    const variantMap: Record<string, InventoryItem[]> = {};
    for (const inv of inventory) {
      if (!variantMap[inv.product_variant_id]) variantMap[inv.product_variant_id] = [];
      variantMap[inv.product_variant_id].push(inv);
    }

    for (const [variantId, items] of Object.entries(variantMap)) {
      if (items.length < 2) continue;

      // Find surplus warehouse (>50 available) and deficit warehouse (<= 5 available)
      const surplus = items.find((i) => i.quantity_available > 50);
      const deficit = items.find((i) => i.quantity_available <= 10);

      if (surplus && deficit) {
        const sourceWh = warehouses.find((w) => w.id === surplus.warehouse_id);
        const targetWh = warehouses.find((w) => w.id === deficit.warehouse_id);

        if (sourceWh && targetWh) {
          const transferQty = Math.min(25, Math.floor((surplus.quantity_available - deficit.quantity_available) / 2));
          recommendations.push({
            source_warehouse_id: sourceWh.id,
            source_warehouse_name: sourceWh.name,
            target_warehouse_id: targetWh.id,
            target_warehouse_name: targetWh.name,
            product_variant_id: variantId,
            sku: (surplus as any).sku || "SKU",
            recommended_transfer_quantity: transferQty,
            reason: `Deficit detected at ${targetWh.name} (stock: ${deficit.quantity_available}) while ${sourceWh.name} has surplus (${surplus.quantity_available}).`,
            estimated_transit_hours: 12,
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * Reconciles physical inventory count against system records and flags variances
   */
  public auditDiscrepancies(
    tenantId: string,
    physicalCounts: Array<{ variantId: string; warehouseId: string; physicalCount: number }>
  ): Array<{
    variant_id: string;
    warehouse_id: string;
    system_count: number;
    physical_count: number;
    variance: number;
    severity: "LOW" | "MEDIUM" | "HIGH";
  }> {
    const results = [];
    const inventory = db.getInventory(tenantId);

    for (const physical of physicalCounts) {
      const record = inventory.find(
        (i) => i.product_variant_id === physical.variantId && i.warehouse_id === physical.warehouseId
      );
      const systemCount = record ? record.quantity_on_hand : 0;
      const variance = physical.physicalCount - systemCount;

      if (variance !== 0) {
        const absVariance = Math.abs(variance);
        results.push({
          variant_id: physical.variantId,
          warehouse_id: physical.warehouseId,
          system_count: systemCount,
          physical_count: physical.physicalCount,
          variance,
          severity: absVariance > 20 ? ("HIGH" as const) : absVariance > 5 ? ("MEDIUM" as const) : ("LOW" as const),
        });
      }
    }

    return results;
  }
}

export const inventoryOperationsService = new InventoryOperationsService();
