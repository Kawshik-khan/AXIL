import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { ConnectionsService } from "@/domains/connectors/connections.service";

/** Sign-in connection health across workspaces: counts only, plus whether the Meta app is set up (ADR-119 P6). */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, PLATFORM_PERMISSIONS.INTEGRATION_READ);
    return apiSuccess(ConnectionsService.platformHealth());
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
