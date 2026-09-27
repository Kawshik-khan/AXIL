import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const conversation = await ConversationService.assignConversation(
      context,
      params.id,
      body.assigned_user_id,
      body.assigned_team_id,
      body.notes
    );

    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}
