import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformFeatureFlagService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const flags = PlatformFeatureFlagService.listFlags(context);
    return apiSuccess(flags);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { key, description, is_enabled_globally, percentage_rollout, scope, tenant_allowlist, rules, reason } = body;
    const flag = PlatformFeatureFlagService.saveFlag(
      { key, description, is_enabled_globally, percentage_rollout, scope, tenant_allowlist, rules },
      reason,
      context
    );
    return apiSuccess(flag);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
