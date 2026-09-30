import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const conversation = await ConversationService.reopenConversation(context, params.id);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
