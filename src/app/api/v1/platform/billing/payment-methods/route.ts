import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { platformBillingReadiness } from "@/domains/payments/gateways/gateway-accounts";
import { withStore } from "@/lib/store-unit";

/**
 * Whether workspaces can pay a subscription on this install, and how: the online gateways the platform has an account
 * for (names only, never credentials) and the manual bKash / Nagad / bank details workspaces see. Read-only.
 */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "billing.read");
    return apiSuccess(platformBillingReadiness());
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
