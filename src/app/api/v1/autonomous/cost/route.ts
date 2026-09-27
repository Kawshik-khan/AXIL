import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { platformEconomicsService } from "@/domains/autonomous/services";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTONOMOUS_READ);
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") || "DAILY") as "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";
    const breakdown = platformEconomicsService.getCostBreakdown(context.tenant.id, period);
    const efficiency = platformEconomicsService.optimizeCostEfficiency(context.tenant.id);
    const entityCosts = platformEconomicsService.getEntityCosts(context.tenant.id);
    return apiSuccess({ breakdown, efficiency, entity_costs: entityCosts });
  } catch (err) {
    return apiError(err);
  }
}
