import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const conversation = await ConversationService.getConversationById(context, params.id);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    let updated = await ConversationService.getConversationById(context, params.id);
    if (body.status) {
      updated = await ConversationService.updateStatus(context, params.id, body.status);
    }
    if (body.automation_paused !== undefined) {
      updated = await ConversationService.setAutomationPaused(context, params.id, body.automation_paused);
    }

    return apiSuccess({ conversation: updated });
  } catch (err) {
    return apiError(err);
  }
}
