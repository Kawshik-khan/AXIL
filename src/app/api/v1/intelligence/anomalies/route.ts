import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const anomalies = anomalyDetectorService.detectAnomalies(context.tenant.id);
    return apiSuccess({ anomalies, total: anomalies.length });
  } catch (err) {
    return apiError(err);
  }
}
