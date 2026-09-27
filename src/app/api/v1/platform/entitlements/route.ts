import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformEntitlementService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (tenantId) {
      const tenantStatus = PlatformEntitlementService.getTenantEntitlementsStatus(tenantId, context);
      return apiSuccess(tenantStatus);
    }

    const entitlements = PlatformEntitlementService.listEntitlements(context);
    return apiSuccess(entitlements);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { tenant_id, entitlement_id, value, reason } = body;
    const result = PlatformEntitlementService.setTenantOverride(tenant_id, entitlement_id, value, reason, context);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
