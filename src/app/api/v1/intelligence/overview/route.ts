import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { salesIntelligenceService } from "@/domains/intelligence/services/sales-intelligence.service";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";
import { opportunityDetectorService } from "@/domains/intelligence/services/opportunity-detector.service";
import { riskDetectorService } from "@/domains/intelligence/services/risk-detector.service";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;

    const sales = salesIntelligenceService.getOverview(tenantId);
    const anomalies = anomalyDetectorService.detectAnomalies(tenantId);
    const opportunities = opportunityDetectorService.detectOpportunities(tenantId);
    const risks = riskDetectorService.detectRisks(tenantId);
    const recommendations = recommendationService.generateRecommendations(tenantId);

    return apiSuccess({
      sales,
      anomalies_count: anomalies.length,
      opportunities_count: opportunities.length,
      risks_count: risks.length,
      recommendations_count: recommendations.length,
      top_anomalies: anomalies.slice(0, 5),
      top_opportunities: opportunities.slice(0, 5),
      top_risks: risks.slice(0, 5),
      top_recommendations: recommendations.slice(0, 5),
    });
  } catch (err) {
    return apiError(err);
  }
}
