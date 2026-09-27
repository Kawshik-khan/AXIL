import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { forecastingService } from "@/domains/intelligence/services/forecasting.service";
import { ForecastHorizon } from "@/types/intelligence";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const body = await request.json();

    const targetType: "DEMAND" | "SALES_REVENUE" | "ORDER_VOLUME" | "INVENTORY_DEPLETION" = body.target_type || "SALES_REVENUE";
    const horizon: ForecastHorizon = body.horizon || "30D";
    const entityId = body.entity_id;

    const forecast = forecastingService.generateForecast({
      tenantId: context.tenant.id,
      targetType,
      horizon,
      entityId,
    });

    return apiSuccess({ forecast });
  } catch (err) {
    return apiError(err);
  }
}
