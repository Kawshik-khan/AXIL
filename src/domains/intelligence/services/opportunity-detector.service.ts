/**
 * CommerceOS Phase 6: Opportunity Detection Engine
 * Discovers revenue-generating actions: rising products, restock opportunities, and repeat buyer campaigns.
 */

import { db } from "@/infrastructure/db";
import { Opportunity } from "@/types/intelligence";
import { evidenceService } from "./evidence.service";
import { inventoryIntelligenceService } from "./inventory-intelligence.service";
import { productIntelligenceService } from "./product-intelligence.service";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class OpportunityDetectorService {
  /**
   * Scans tenant commerce state for actionable business opportunities and stores them (one write, idempotent).
   */
  public detectOpportunities(tenantId: string): Opportunity[] {
    return intelligenceSnapshots.persist(tenantId, "opportunities", this.computeOpportunities(tenantId));
  }

  /** Pure (FX-21): opportunities with deterministic ids `opp_${tenant}_${kind}_${entity}`. */
  public computeOpportunities(tenantId: string): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const products = productIntelligenceService.computeProductPerformance(tenantId);
    const inventory = inventoryIntelligenceService.computeInventoryHealth(tenantId);

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
        id: `opp_${tenantId}_rising_${topSeller.product_id}`,
        tenant_id: tenantId,
        type: "RISING_PRODUCT",
        title: `Scale Ad Campaign for '${topSeller.product_name}'`,
        description: `High conversion velocity and positive customer retention make this product an ideal candidate for expanded social promotion.`,
        evidence: [evidence],
        affected_entities: [{ type: "PRODUCT", id: topSeller.product_id, name: topSeller.product_name }],
        // No projection: the +30% revenue / +35% orders were assumed factors (FX-30). The evidence has the real 30-day numbers.
        estimated_impact: {
          timeframe_days: 14,
        },
        confidence: 0.88,
        priority: "HIGH",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

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
        id: `opp_${tenantId}_restock_${lowStockHighDemand.variant_id}`,
        tenant_id: tenantId,
        type: "RESTOCK_DEMAND",
        title: `Reorder ${lowStockHighDemand.recommended_reorder_qty} Units of '${lowStockHighDemand.product_name}'`,
        description: `Prevent stockout and capture projected upcoming demand by issuing an immediate supplier replenishment order.`,
        evidence: [evidence],
        affected_entities: [{ type: "INVENTORY_VARIANT", id: lowStockHighDemand.variant_id, name: lowStockHighDemand.product_name }],
        estimated_impact: {
          // Reorder quantity at the variant's own price (was x ৳1,200 for every product)
          potential_revenue_bdt: (() => {
            const price = db.findVariantById(tenantId, lowStockHighDemand.variant_id)?.price;
            return typeof price === "number" ? Math.round(lowStockHighDemand.recommended_reorder_qty * price) : undefined;
          })(),
          timeframe_days: 30,
        },
        confidence: 0.92,
        priority: "HIGH",
        expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

      opportunities.push(opp);
    }

    // 3. Repeat Buyer Campaign Opportunity
    const customers = db.getAllCustomers(tenantId);
    if (customers.length >= 2) {
      const opp: Opportunity = {
        id: `opp_${tenantId}_repeat_buyers`,
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
          timeframe_days: 7, // no projection: there's no re-engagement history (was a literal ৳18,500 / 12 orders)
        },
        confidence: 0.85,
        priority: "MEDIUM",
        expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        status: "OPEN",
        created_at: new Date().toISOString(),
      };

      opportunities.push(opp);
    }

    return opportunities;
  }
}

export const opportunityDetectorService = new OpportunityDetectorService();
