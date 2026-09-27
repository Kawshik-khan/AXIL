import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "n8n.read");

    const instances = (db.data.n8n_instances || []).map((inst) => ({
      id: inst.id,
      name: inst.name,
      base_url: inst.base_url,
      environment: inst.environment,
      status: inst.status,
      health_status: inst.health_status,
      latency_ms: inst.latency_ms,
      workflow_count: inst.workflow_count,
      failure_rate: inst.failure_rate,
      last_health_check_at: inst.last_health_check_at,
      credential_reference: inst.credential_reference, // Sanitized reference token, never raw secret
    }));

    return apiSuccess({
      instances,
      cluster_summary: {
        total: instances.length,
        healthy: instances.filter((i) => i.health_status === "HEALTHY").length,
        degraded: instances.filter((i) => i.health_status === "DEGRADED").length,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
