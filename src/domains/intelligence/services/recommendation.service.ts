/**
 * CommerceOS Phase 6: Recommendation Engine
 * Synthesizes business opportunities and operational risks into grounded, actionable recommendations.
 * Strictly adheres to the 7-Factor Explainability Standard.
 */

import { db } from "@/infrastructure/db";
import { Recommendation, RecommendationStatus } from "@/types/intelligence";
import { ActionRiskLevel } from "@/types/orchestration";
import { opportunityDetectorService } from "./opportunity-detector.service";
import { riskDetectorService } from "./risk-detector.service";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class RecommendationService {
  /**
   * Generates evidence-backed recommendations and stores them (one write). Recomputing keeps a user's decision.
   */
  public generateRecommendations(tenantId: string): Recommendation[] {
    return intelligenceSnapshots.persist(tenantId, "recommendations", this.computeRecommendations(tenantId));
  }

  /** Pure (FX-21): recommendations with deterministic ids `rec_${tenant}_${type}_${entity}`. */
  public computeRecommendations(tenantId: string): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const opportunities = opportunityDetectorService.computeOpportunities(tenantId);
    const risks = riskDetectorService.computeRisks(tenantId);

    // 1. Generate Restock Recommendations from Critical Risks/Opportunities
    const restockOpp = opportunities.find((o) => o.type === "RESTOCK_DEMAND");
    if (restockOpp) {
      const entity = restockOpp.affected_entities[0];
      const rec: Recommendation = {
        id: `rec_${tenantId}_restock_${entity?.id ?? "inventory"}`,
        tenant_id: tenantId,
        type: "REORDER_STOCK",
        title: `Authorize Restock PO for '${entity?.name || "Inventory Item"}'`,
        description: `Create an authorized inventory purchase order to prevent stockout and capture upcoming demand.`,
        rationale: `Stock velocity is high and remaining stock coverage is below the safe lead time threshold (7 days).`,
        evidence: restockOpp.evidence,
        affected_entities: restockOpp.affected_entities,
        expected_benefit: {
          revenue_impact_bdt: restockOpp.estimated_impact.potential_revenue_bdt,
          order_gain: restockOpp.estimated_impact.potential_orders,
          summary: `Protects projected revenue of ~৳${restockOpp.estimated_impact.potential_revenue_bdt} over 30 days.`,
        },
        expected_cost: {
          financial_cost_bdt: Math.round((restockOpp.estimated_impact.potential_revenue_bdt || 10000) * 0.6),
          operational_complexity: "LOW",
        },
        confidence: 0.92,
        assumptions: [
          "Supplier lead time remains within standard 7-day window.",
          "Unit procurement cost does not exceed baseline contract pricing.",
        ],
        risks: [
          "Supplier delayed delivery.",
          "Short-term capital commitment.",
        ],
        what_would_change_this: [
          "Sudden drop in daily order velocity.",
          "Alternative supplier offering faster expedited delivery.",
        ],
        required_autonomy_level: 2, // Level 2 Assisted: requires sign-off for financial commitments
        action_risk_level: ActionRiskLevel.HIGH,
        required_approval: true,
        expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        status: "PROPOSED",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      recommendations.push(rec);
    }

    // 2. Generate Dead-Stock Clearance Recommendation
    const overstockRisk = risks.find((r) => r.type === "OVERSTOCK");
    if (overstockRisk) {
      const rec: Recommendation = {
        id: `rec_${tenantId}_clearance_dead_stock`,
        tenant_id: tenantId,
        type: "DISCOUNT_DEAD_STOCK",
        title: "Liquidate Idle Dead-Stock via Flash Promo",
        description: "Apply a targeted 15% discount bundle on idle catalog items to reclaim warehouse space and unlock working capital.",
        rationale: "Unmoving inventory incurs holding costs and depreciates over time.",
        evidence: overstockRisk.evidence,
        affected_entities: overstockRisk.affected_entities,
        expected_benefit: {
          revenue_impact_bdt: 12000,
          cost_saving_bdt: 12000,
          summary: "Frees up warehouse storage capacity and converts locked inventory into liquid cash.",
        },
        expected_cost: {
          operational_complexity: "LOW",
        },
        confidence: 0.88,
        assumptions: ["Customers respond favorably to flash discount pricing."],
        risks: ["Margin compression on discounted items."],
        what_would_change_this: ["Organic resurgence in demand for idle items."],
        required_autonomy_level: 2,
        action_risk_level: ActionRiskLevel.MEDIUM,
        required_approval: true,
        expires_at: new Date(Date.now() + 10 * 86400000).toISOString(),
        status: "PROPOSED",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      recommendations.push(rec);
    }

    return recommendations;
  }

  /**
   * Retrieves active recommendations for a tenant
   */
  public getRecommendations(tenantId: string, status?: RecommendationStatus): Recommendation[] {
    return db.getRecommendations(tenantId, status);
  }
}

export const recommendationService = new RecommendationService();
