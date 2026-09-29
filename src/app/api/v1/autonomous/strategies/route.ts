import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { strategyEngineService } from "@/domains/autonomous/services";
import { StrategyStatus } from "@/types/autonomous";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.STRATEGY_READ);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as StrategyStatus | null;
    const strategies = strategyEngineService.getStrategies(context.tenant.id, status || undefined);
    return apiSuccess({ total: strategies.length, strategies });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
