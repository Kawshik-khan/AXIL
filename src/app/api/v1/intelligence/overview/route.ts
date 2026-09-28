import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { salesIntelligenceService } from "@/domains/intelligence/services/sales-intelligence.service";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";
import { opportunityDetectorService } from "@/domains/intelligence/services/opportunity-detector.service";
import { riskDetectorService } from "@/domains/intelligence/services/risk-detector.service";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";

/** Read-only (FX-21): stored snapshots while fresh, otherwise computed for this request. Never writes. */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;
    const sales = salesIntelligenceService.getOverview(tenantId);
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
