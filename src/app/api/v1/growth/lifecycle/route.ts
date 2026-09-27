import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const distribution = customerLifecycleService.getLifecycleDistribution(tenantId);
    const transitions = db.getLifecycleTransitions(tenantId);

    return apiSuccess({
      distribution,
      transitions,
      total_transition_events: transitions.length,
    });
  } catch (err) {
    return apiError(err);
  }
}
