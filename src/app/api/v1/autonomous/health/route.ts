import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { platformHealthService } from "@/domains/autonomous/services";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTONOMOUS_READ);
    const health = platformHealthService.getSystemHealth(context.tenant.id);
    const scorecard = platformHealthService.getQualityScorecard(context.tenant.id, "DAILY");
    const domainHealth = health?.dimensions || {};
    return apiSuccess({ health, scorecard, domain_health: domainHealth });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
