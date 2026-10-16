import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformEntitlementService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

/** The entitlement catalog with global defaults. Per-tenant values: /api/v1/platform/tenants/[id]/entitlements. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformEntitlementService.listEntitlements(context));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
