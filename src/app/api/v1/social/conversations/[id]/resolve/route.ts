import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const conversation = await ConversationService.resolveConversation(context, params.id);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
