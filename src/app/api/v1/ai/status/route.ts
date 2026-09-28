import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { modelRouter } from "@/domains/ai/providers/model-router";

/**
 * Which AI is answering (FX-32): LIVE (a configured provider), DEMO (offline keyword mock) or NOT_CONFIGURED. The UI
 * shows a "Demo AI (offline)" badge on everything the demo answers, instead of presenting it as a model.
 */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);
    const status = modelRouter.getStatus();
    return apiSuccess({ mode: status.mode, provider: status.provider, models: status.models });
  } catch (err) {
    return apiError(err);
  }
}
