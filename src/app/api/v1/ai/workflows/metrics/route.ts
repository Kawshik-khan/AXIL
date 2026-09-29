import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { orchestrationTelemetry } from "@/domains/ai/orchestration/telemetry/orchestration-telemetry";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const metrics = orchestrationTelemetry.getTenantMetrics(context.tenant.id);
    return apiSuccess(metrics);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
