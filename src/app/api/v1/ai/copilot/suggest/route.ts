import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { CopilotService } from "@/domains/ai/copilot/copilot.service";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

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
