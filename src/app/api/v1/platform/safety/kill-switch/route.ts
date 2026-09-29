import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSafetyService } from "@/domains/platform";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const switches = PlatformSafetyService.getKillSwitches(context);
    return apiSuccess(switches);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { action, scope, targetId, id, reason } = body;

    if (action === "DEACTIVATE") {
      if (!id) throw new AppError("ID_REQUIRED", "Kill switch ID is required for deactivation.", 400);
      const res = PlatformSafetyService.deactivateKillSwitch(id, reason, context);
      return apiSuccess(res);
    }

    if (!scope) {
      throw new AppError("SCOPE_REQUIRED", "Scope is required (GLOBAL, TENANT, WORKFLOW, PROVIDER, etc.).", 400);
    }

    const res = PlatformSafetyService.activateKillSwitch({ scope, targetId, reason }, context);
    return apiSuccess(res);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
