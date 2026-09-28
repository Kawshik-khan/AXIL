/**
 * CommerceOS Phase 6: Opportunity Detection Engine
 * Discovers revenue-generating actions: rising products, restock opportunities, and repeat buyer campaigns.
 */

import { db } from "@/infrastructure/db";
import { Opportunity } from "@/types/intelligence";
import { evidenceService } from "./evidence.service";
import { inventoryIntelligenceService } from "./inventory-intelligence.service";
import { productIntelligenceService } from "./product-intelligence.service";

export class OpportunityDetectorService {
  /**
   * Scans tenant commerce state to discover actionable business opportunities
   */
  public detectOpportunities(tenantId: string): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const products = productIntelligenceService.analyzeProductPerformance(tenantId);
    const inventory = inventoryIntelligenceService.analyzeInventoryHealth(tenantId);

    // 1. Rising Product Opportunity
    const topSeller = products.find((p) => p.status_tag === "BEST_SELLER" || p.status_tag === "EMERGING");
    if (topSeller) {
      const evidence = evidenceService.createEvidence({
        sourceType: "METRIC",
        sourceId: `prod_${topSeller.product_id}`,
        metric: "performance_score",
        value: topSeller.performance_score,
        description: `Product '${topSeller.product_name}' has high score (${topSeller.performance_score}/100) with 30-day revenue of ৳${topSeller.revenue_bdt_30d}.`,
      });

      const opp: Opportunity = {
        id: `opp_rising_${topSeller.product_id}_${tenantId}`,
        tenant_id: tenantId,
        type: "RISING_PRODUCT",
        title: `Scale Ad Campaign for '${topSeller.product_name}'`,
        description: `High conversion velocity and positive customer retention make this product an ideal candidate for expanded social promotion.`,
        evidence: [evidence],
        affected_entities: [{ type: "PRODUCT", id: topSeller.product_id, name: topSeller.product_name }],
        estimated_impact: {
          potential_revenue_bdt: Math.round(topSeller.revenue_bdt_30d * 0.3),
          potential_orders: Math.round(topSeller.units_sold_30d * 0.35),
          timeframe_days: 14,
        },
        confidence: 0.88,
        priority: "HIGH",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

      db.insertOpportunity(opp);
      opportunities.push(opp);
    }

    // 2. High Demand Restock Opportunity
    const lowStockHighDemand = inventory.find(
      (i) => (i.stockout_risk_level === "CRITICAL" || i.stockout_risk_level === "HIGH") && i.average_daily_demand_30d > 0.3
    );
    if (lowStockHighDemand) {
      const evidence = evidenceService.createEvidence({
        sourceType: "INVENTORY",
        sourceId: `inv_${lowStockHighDemand.variant_id}`,
        metric: "days_of_inventory_remaining",
        value: lowStockHighDemand.days_of_inventory_remaining,
        description: `SKU '${lowStockHighDemand.sku}' has only ${lowStockHighDemand.available_stock} units left (${lowStockHighDemand.days_of_inventory_remaining} days of stock).`,
      });

      const opp: Opportunity = {
        id: `opp_restock_${lowStockHighDemand.variant_id}_${tenantId}`,
        tenant_id: tenantId,
        type: "RESTOCK_DEMAND",
        title: `Reorder ${lowStockHighDemand.recommended_reorder_qty} Units of '${lowStockHighDemand.product_name}'`,
        description: `Prevent stockout and capture projected upcoming demand by issuing an immediate supplier replenishment order.`,
        evidence: [evidence],
        affected_entities: [{ type: "INVENTORY_VARIANT", id: lowStockHighDemand.variant_id, name: lowStockHighDemand.product_name }],
        estimated_impact: {
          potential_revenue_bdt: Math.round(lowStockHighDemand.recommended_reorder_qty * 1200),
          potential_orders: lowStockHighDemand.recommended_reorder_qty,
          timeframe_days: 30,
        },
        confidence: 0.92,
        priority: "HIGH",
        expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

      db.insertOpportunity(opp);
      opportunities.push(opp);
    }

    // 3. Repeat Buyer Campaign Opportunity
    const customers = db.getAllCustomers(tenantId);
    if (customers.length >= 2) {
      const opp: Opportunity = {
        id: `opp_repeat_${Date.now()}_${tenantId}`,
        tenant_id: tenantId,
        type: "REPEAT_BUYER_CAMPAIGN",
        title: "Launch WhatsApp Re-Engagement for Returning Shoppers",
        description: "Target past buyers with exclusive early access coupon to drive repeat purchasing frequency.",
        evidence: [
          evidenceService.createEvidence({
            sourceType: "CUSTOMER",
            sourceId: `cust_cohort_${tenantId}`,
            metric: "customer_base",
            value: customers.length,
            description: `Tenant possesses ${customers.length} verified customer profiles with repeat potential.`,
          }),
        ],
        affected_entities: [{ type: "CUSTOMER_SEGMENT", id: "LOYAL_CUSTOMERS", name: "Repeat Buyer Segment" }],
        estimated_impact: {
          potential_revenue_bdt: 18500,
          potential_orders: 12,
          timeframe_days: 7,
        },
        confidence: 0.85,
        priority: "MEDIUM",
        expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

      db.insertOpportunity(opp);
      opportunities.push(opp);
    }

    return opportunities;
  }
}

export const opportunityDetectorService = new OpportunityDetectorService();
