import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const conversation = await ConversationService.reopenConversation(context, params.id);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}
