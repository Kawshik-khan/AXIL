import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { metricRegistryService } from "@/domains/intelligence/services/metric-registry.service";
import { MetricCategory } from "@/types/intelligence";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as MetricCategory | null;
    const key = searchParams.get("key");

    if (key) {
      const metric = metricRegistryService.getDefinition(key);
      if (!metric) {
        return apiSuccess({ found: false }, undefined, 404);
      }
      return apiSuccess({ found: true, metric });
    }

    const definitions = metricRegistryService.getDefinitions(category || undefined);
    return apiSuccess({ definitions, total: definitions.length });
  } catch (err) {
    return apiError(err);
  }
}
