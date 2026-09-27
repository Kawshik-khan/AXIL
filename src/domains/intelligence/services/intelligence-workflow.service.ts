/**
 * CommerceOS Phase 6: Intelligence Workflow Service
 * Orchestrates scheduled & reactive recurring intelligence workflows:
 * - DAILY_EXECUTIVE_BRIEF
 * - LOW_STOCK_INTELLIGENCE
 * - SALES_DROP_ANALYSIS
 * - WEEKLY_COMMERCE_REVIEW
 */

import { salesIntelligenceService } from "./sales-intelligence.service";
import { inventoryIntelligenceService } from "./inventory-intelligence.service";
import { productIntelligenceService } from "./product-intelligence.service";
import { anomalyDetectorService } from "./anomaly-detector.service";
import { opportunityDetectorService } from "./opportunity-detector.service";
import { recommendationService } from "./recommendation.service";
import { cohortAnalysisService } from "./cohort-analysis.service";
import { deliveryIntelligenceService } from "./delivery-intelligence.service";
import { paymentIntelligenceService } from "./payment-intelligence.service";
import { Recommendation } from "@/types/intelligence";

export interface WorkflowExecutionSummary {
  workflow_type: "DAILY_EXECUTIVE_BRIEF" | "LOW_STOCK_INTELLIGENCE" | "SALES_DROP_ANALYSIS" | "WEEKLY_COMMERCE_REVIEW";
  tenant_id: string;
  status: "COMPLETED" | "WARNING" | "FAILED";
  executed_at: string;
  metrics: Record<string, any>;
  anomalies_found: number;
  recommendations_generated: number;
  digest_markdown: string;
}

export class IntelligenceWorkflowService {
  /**
   * Runs the 24-hour Daily Executive Brief
   */
  public runDailyExecutiveBrief(tenantId: string): WorkflowExecutionSummary {
    const sales = salesIntelligenceService.getOverview(tenantId);
    const anomalies = anomalyDetectorService.detectAnomalies(tenantId);
    const opportunities = opportunityDetectorService.detectOpportunities(tenantId);
    const recommendations = recommendationService.generateRecommendations(tenantId);
    const aov = sales.total_orders > 0 ? Number((sales.total_revenue_bdt / sales.total_orders).toFixed(2)) : 0;

    const digest = `### 📊 Daily Executive Commerce Brief
- **30-Day Revenue**: ৳${sales.total_revenue_bdt.toLocaleString()}
- **Total Orders**: ${sales.total_orders} (AOV: ৳${aov})
- **Top Channel**: ${sales.channels[0]?.channel || "Website"} (৳${sales.channels[0]?.revenue.toLocaleString() || 0})
- **Anomalies Detected**: ${anomalies.length}
- **High-Impact Recommendations**: ${recommendations.length}
`;

    return {
      workflow_type: "DAILY_EXECUTIVE_BRIEF",
      tenant_id: tenantId,
      status: "COMPLETED",
      executed_at: new Date().toISOString(),
      metrics: {
        revenue: sales.total_revenue_bdt,
        orders: sales.total_orders,
        aov,
        opportunities: opportunities.length,
      },
      anomalies_found: anomalies.length,
      recommendations_generated: recommendations.length,
      digest_markdown: digest,
    };
  }

  /**
   * Evaluates inventory stock and auto-generates restock recommendations
   */
  public runLowStockIntelligence(tenantId: string): WorkflowExecutionSummary {
    const inventory = inventoryIntelligenceService.analyzeInventoryHealth(tenantId);
    const criticalItems = inventory.filter(
      (i) => i.stockout_risk_level === "CRITICAL" || i.stockout_risk_level === "HIGH"
    );

    const recommendations = recommendationService.generateRecommendations(tenantId);
    const restockRecs = recommendations.filter((r: Recommendation) => r.type === "REORDER_STOCK");

    const digest = `### 📦 Low Stock & Replenishment Intelligence
- **Critical / High Stockout SKUs**: ${criticalItems.length}
- **Immediate Reorder Proposals**: ${restockRecs.length}
- **Items Monitored**: ${inventory.length}
`;

    return {
      workflow_type: "LOW_STOCK_INTELLIGENCE",
      tenant_id: tenantId,
      status: criticalItems.length > 0 ? "WARNING" : "COMPLETED",
      executed_at: new Date().toISOString(),
      metrics: {
        critical_count: criticalItems.length,
        total_skus: inventory.length,
      },
      anomalies_found: 0,
      recommendations_generated: restockRecs.length,
      digest_markdown: digest,
    };
  }

  /**
   * Investigates sales drops and correlates causes (stockouts, payment failures, logistics)
   */
  public runSalesDropAnalysis(tenantId: string): WorkflowExecutionSummary {
    const sales = salesIntelligenceService.getOverview(tenantId);
    const payments = paymentIntelligenceService.analyzePayments(tenantId);
    const delivery = deliveryIntelligenceService.analyzeDelivery(tenantId);
    const anomalies = anomalyDetectorService.detectAnomalies(tenantId);
    const recommendations = recommendationService.generateRecommendations(tenantId);

    const isDrop = anomalies.some((a) => a.metric.includes("sales") || a.metric.includes("revenue"));

    const digest = `### ⚠️ Sales Drop & Diagnostic Investigation
- **Total Revenue (30d)**: ৳${sales.total_revenue_bdt.toLocaleString()}
- **Payment Success Rate**: ${payments.overall_success_rate_pct}% (Unreconciled COD: ৳${payments.unreconciled_cod_bdt})
- **Courier Return Rate (RTO)**: ${delivery.overall_rto_rate_pct}%
- **Anomalies Explaining Drop**: ${anomalies.length}
`;

    return {
      workflow_type: "SALES_DROP_ANALYSIS",
      tenant_id: tenantId,
      status: isDrop ? "WARNING" : "COMPLETED",
      executed_at: new Date().toISOString(),
      metrics: {
        total_revenue_bdt: sales.total_revenue_bdt,
        payment_success_rate: payments.overall_success_rate_pct,
        rto_rate: delivery.overall_rto_rate_pct,
      },
      anomalies_found: anomalies.length,
      recommendations_generated: recommendations.length,
      digest_markdown: digest,
    };
  }

  /**
   * Generates weekly comprehensive commerce review (Cohorts, SLA, Dead Stock)
   */
  public runWeeklyCommerceReview(tenantId: string): WorkflowExecutionSummary {
    const cohorts = cohortAnalysisService.analyzeCohorts(tenantId);
    const delivery = deliveryIntelligenceService.analyzeDelivery(tenantId);
    const products = productIntelligenceService.analyzeProductPerformance(tenantId);
    const deadStock = products.filter((p) => p.status_tag === "SLOW_MOVING" || p.status_tag === "DECLINING");
    const recommendations = recommendationService.generateRecommendations(tenantId);
    const totalShipments = delivery.couriers.reduce((sum, c) => sum + c.total_shipments, 0);

    const digest = `### 📈 Weekly Commerce Review
- **Customer Cohorts Tracked**: ${cohorts.length}
- **Courier Delivery SLA**: ${delivery.overall_delivery_rate_pct}% success across ${totalShipments} parcels
- **Slow Moving / Declining SKUs**: ${deadStock.length} (Candidates for clearance discounts)
- **Active Recommendations**: ${recommendations.length}
`;

    return {
      workflow_type: "WEEKLY_COMMERCE_REVIEW",
      tenant_id: tenantId,
      status: "COMPLETED",
      executed_at: new Date().toISOString(),
      metrics: {
        cohorts_count: cohorts.length,
        dead_stock_count: deadStock.length,
        delivery_rate_pct: delivery.overall_delivery_rate_pct,
      },
      anomalies_found: 0,
      recommendations_generated: recommendations.length,
      digest_markdown: digest,
    };
  }
}

export const intelligenceWorkflowService = new IntelligenceWorkflowService();
