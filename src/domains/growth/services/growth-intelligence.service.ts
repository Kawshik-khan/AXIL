import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Growth Intelligence & Explainable Recommendation Engine
 * Detects commercial growth opportunities/risks and synthesizes 7-factor explainable growth recommendations.
 */

import { db } from "@/infrastructure/db";
import {
  GrowthInsight,
  GrowthOpportunity,
  GrowthRecommendation,
} from "@/types/growth";
import { ActionRiskLevel } from "@/types/orchestration";
import { customerLifecycleService } from "./customer-lifecycle.service";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";

export class GrowthIntelligenceService {
  /**
   * Detects growth insights and commercial patterns across customer transactions
   */
  public detectGrowthInsights(tenantId: string): GrowthInsight[] {
    return intelligenceSnapshots.persist(tenantId, "growth_insights", this.computeGrowthInsights(tenantId));
  }

  /**
   * Pure (FX-21): growth insights as of now, with deterministic ids `ins_${tenant}_${type}`. Replaces the old
   * behaviour of returning the first stored result forever.
   */
  public computeGrowthInsights(tenantId: string): GrowthInsight[] {
    const insights: GrowthInsight[] = [];
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const lifecycles = db.getCustomerLifecycles(tenantId);
    const now = new Date().toISOString();

    // 1. Detect High-Value Dormancy Risk
    const highValueDormant = lifecycles.filter(
      (l) => (l.stage === "DORMANT" || l.stage === "AT_RISK") && l.total_revenue_bdt > 10000
    );

    if (highValueDormant.length > 0) {
      insights.push({
        id: `ins_${tenantId}_high_value_dormancy`,
        tenant_id: tenantId,
        type: "HIGH_VALUE_DORMANCY",
        title: `${highValueDormant.length} High-Value Customers Entering Dormancy`,
        summary: `Identified ${highValueDormant.length} VIP customers with >৳10,000 historical spend who have not ordered in over 45 days.`,
        evidence: highValueDormant.slice(0, 10).map((c, i) => ({
          id: `evi_dormant_${i}_${Date.now()}`,
          source_type: "CUSTOMER" as const,
          source_id: c.customer_id,
          metric: "historical_spend",
          value: c.total_revenue_bdt,
          timestamp: now,
          confidence: 0.95,
          query_version: "v1.0",
          description: `Historical Spend: ৳${c.total_revenue_bdt}, Stage: ${c.stage}`,
        })),
        severity: "HIGH",
        detected_at: now,
      });
    }

    // 2. Detect Repeat Purchase Rate
    const repeatCustomers = lifecycles.filter((l) => l.order_count >= 2);
    const totalPurchasers = lifecycles.filter((l) => l.order_count >= 1);
    const repeatRate = totalPurchasers.length > 0 ? (repeatCustomers.length / totalPurchasers.length) * 100 : 0;

    if (totalPurchasers.length >= 5 && repeatRate < 25) {
      insights.push({
        id: `ins_${tenantId}_repeat_purchase_drop`,
        tenant_id: tenantId,
        type: "REPEAT_PURCHASE_DROP",
        title: "Sub-Optimal Repeat Purchase Rate Detected",
        summary: `Repeat customer rate is currently ${repeatRate.toFixed(1)}% (Benchmark: >30%). First-time buyers are not converting into repeat buyers.`,
        evidence: [
          {
            id: `evi_repeat_${Date.now()}_${randomSuffix()}`,
            source_type: "METRIC" as const,
            source_id: "analytics_rollups",
            metric: "repeat_customer_rate",
            value: Number(repeatRate.toFixed(1)),
            timestamp: now,
            confidence: 0.9,
            query_version: "v1.0",
            description: `Repeat customer rate is currently ${repeatRate.toFixed(1)}%`,
          },
        ],
        severity: "MEDIUM",
        detected_at: now,
      });
    }

    return insights;
  }

  /**
   * Synthesizes 7-factor explainable growth recommendations
   */
  public generateGrowthRecommendations(tenantId: string): GrowthRecommendation[] {
    return intelligenceSnapshots.persist(tenantId, "growth_recommendations", this.computeGrowthRecommendations(tenantId));
  }

  /** Pure (FX-21): growth recommendations with deterministic ids `grec_${tenant}_${type}`. */
  public computeGrowthRecommendations(tenantId: string): GrowthRecommendation[] {
    const insights = this.computeGrowthInsights(tenantId);
    const recommendations: GrowthRecommendation[] = [];
    const now = new Date();
    const expiry = new Date(Date.now() + 7 * 86400000).toISOString();

    const dormancyInsight = insights.find((i) => i.type === "HIGH_VALUE_DORMANCY");
    const lifecycles = db.getCustomerLifecycles(tenantId);
    if (dormancyInsight) {
      const dormantVips = lifecycles.filter(
        (l) => (l.stage === "DORMANT" || l.stage === "AT_RISK") && l.total_revenue_bdt > 10000
      );
      const pastRevenue = dormantVips.reduce((sum, l) => sum + l.total_revenue_bdt, 0);
      recommendations.push({
        id: `grec_${tenantId}_vip_dormancy_winback`,
        tenant_id: tenantId,
        title: "Execute VIP Dormancy Win-Back Campaign on WhatsApp",
        strategy: "Target high-value dormant purchasers with an exclusive 15% comeback voucher and personalized top catalog picks.",
        target_audience_name: "VIP Dormant Customers (>৳10k LTV)",
        recommended_channel: "WHATSAPP",
        rationale: `${dormantVips.length} customers who spent over ৳10,000 (৳${Math.round(pastRevenue).toLocaleString()} in total) have gone quiet.`,
        evidence: dormancyInsight.evidence,
        expected_impact: {
          projected_revenue_bdt: null,
          projected_roi_multiplier: null,
          summary: "Not estimated: there's no win-back history yet to project a reactivation rate from.",
        },
        action_risk_level: ActionRiskLevel.HIGH,
        required_autonomy_level: 3,
        assumptions: [
          "Customers remain reachable on registered WhatsApp mobile numbers.",
          "Catalog contains sufficient in-stock items in their historically preferred categories.",
        ],
        expires_at: expiry,
        status: "PROPOSED",
        created_at: now.toISOString(),
      });
    }

    // Cross-sell after delivery: only when there were deliveries to follow up (was always proposed, with invented evidence)
    const deliveredLastWeek = db
      .getAllOrders(tenantId)
      .filter((o) => o.status === "DELIVERED" && Date.parse(o.updated_at) >= Date.now() - 7 * 86_400_000).length;
    if (deliveredLastWeek > 0) recommendations.push({
      id: `grec_${tenantId}_post_delivery_cross_sell`,
      tenant_id: tenantId,
      title: "Activate Automated Post-Delivery Accessory Cross-Sell Journey",
      strategy: "Trigger an automated message 3 days after courier delivery recommending top matching accessories with free delivery subsidy.",
      target_audience_name: "Recent Delivered Purchasers (Last 7 Days)",
      recommended_channel: "WHATSAPP",
      rationale: `${deliveredLastWeek} orders were delivered in the last 7 days; a follow-up can suggest related products.`,
      evidence: [
        {
          id: `evi_${tenantId}_delivered_7d`,
          source_type: "ORDER" as const,
          source_id: "orders_delivered_last_7_days",
          metric: "delivered_orders_7d",
          value: deliveredLastWeek,
          timestamp: now.toISOString(),
          confidence: 1,
          query_version: "v1.0",
          description: `${deliveredLastWeek} orders delivered in the last 7 days`,
        },
      ],
      expected_impact: {
        projected_revenue_bdt: null,
        projected_roi_multiplier: null,
        summary: "Not estimated: no cross-sell history yet.",
      },
      action_risk_level: ActionRiskLevel.MEDIUM,
      required_autonomy_level: 2,
      assumptions: ["Steadfast/Pathao courier delivery webhook delivers accurate DELIVERED timestamps."],
      expires_at: expiry,
      status: "PROPOSED",
      created_at: now.toISOString(),
    });

    return recommendations;
  }
}

export const growthIntelligenceService = new GrowthIntelligenceService();
