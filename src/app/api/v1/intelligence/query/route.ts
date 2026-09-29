import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsQueryService } from "@/domains/intelligence/services/analytics-query.service";
import { AnalyticsQuery } from "@/types/intelligence";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const body = await request.json();

    const query: AnalyticsQuery = {
      ...body,
      tenantId: context.tenant.id, // Tenant isolation guaranteed
    };

    const result = analyticsQueryService.executeQuery(query);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
