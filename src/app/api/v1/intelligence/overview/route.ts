import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { db } from "@/infrastructure/db";
import { salesIntelligenceService } from "@/domains/intelligence/services/sales-intelligence.service";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";
import { opportunityDetectorService } from "@/domains/intelligence/services/opportunity-detector.service";
import { riskDetectorService } from "@/domains/intelligence/services/risk-detector.service";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";
import { withStore } from "@/lib/store-unit";

/** Read-only (FX-21): stored snapshots while fresh, otherwise computed for this request. Never writes. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;
    const sales = salesIntelligenceService.getOverview(tenantId);
    // Previous 30 days = last 60 days minus last 30 (FX-30: the page showed literal +12.4% / +8.1%)
    const last60 = salesIntelligenceService.getOverview(tenantId, 60);
    const change = (current: number, previous: number) =>
      previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
    const comparison = {
      revenue_change_pct: change(sales.total_revenue_bdt, last60.total_revenue_bdt - sales.total_revenue_bdt),
      orders_change_pct: change(sales.total_orders, last60.total_orders - sales.total_orders),
    };
    // Delivery success from shipments that reached an outcome (was a literal 94.2%)
    const shipments = db.getShipments(tenantId);
    const delivered = shipments.filter((s) => s.status === "DELIVERED").length;
    const unsuccessful = shipments.filter((s) => s.status === "RETURNED" || s.status === "FAILED").length;
    const delivery = {
      delivered,
      unsuccessful,
      success_rate_pct: delivered + unsuccessful > 0 ? Math.round((delivered / (delivered + unsuccessful)) * 1000) / 10 : null,
    };
    const anomalies = intelligenceSnapshots.read(tenantId, "anomalies", () => anomalyDetectorService.computeAnomalies(tenantId));
    const opportunities = intelligenceSnapshots.read(tenantId, "opportunities", () =>
      opportunityDetectorService.computeOpportunities(tenantId)
    );
    const risks = intelligenceSnapshots.read(tenantId, "risks", () => riskDetectorService.computeRisks(tenantId));
    const recommendations = intelligenceSnapshots.read(tenantId, "recommendations", () =>
      recommendationService.computeRecommendations(tenantId)
    );
    return apiSuccess(
      {
        sales,
        comparison,
        delivery,
        anomalies_count: anomalies.rows.length,
        opportunities_count: opportunities.rows.length,
        risks_count: risks.rows.length,
        recommendations_count: recommendations.rows.length,
        top_anomalies: anomalies.rows.slice(0, 5),
        top_opportunities: opportunities.rows.slice(0, 5),
        top_risks: risks.rows.slice(0, 5),
        top_recommendations: recommendations.rows.slice(0, 5),
      },
      { snapshots: [anomalies.snapshot, opportunities.snapshot, risks.snapshot, recommendations.snapshot] }
    );
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
