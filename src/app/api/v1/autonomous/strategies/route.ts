import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { strategyEngineService } from "@/domains/autonomous/services";
import { StrategyStatus } from "@/types/autonomous";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as StrategyStatus | null;
    const strategies = strategyEngineService.getStrategies(context.tenant.id, status || undefined);
    return apiSuccess({ total: strategies.length, strategies });
  } catch (err) {
    return apiError(err);
  }
}
