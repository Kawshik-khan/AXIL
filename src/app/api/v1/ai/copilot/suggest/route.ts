import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { CopilotService } from "@/domains/ai/copilot/copilot.service";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);
    enforceRateLimit(`ai:user:${context.user.id}`, 30, MINUTE); // costly model calls (FX-14)

    const body = await request.json();
    if (!body.conversation_id) {
      throw new AppError("VALIDATION_ERROR", "conversation_id is required", 400);
    }

    const suggestion = await CopilotService.generateSuggestion(context, body.conversation_id);
    return apiSuccess(suggestion);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
