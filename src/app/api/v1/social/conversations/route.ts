import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const channel_id = searchParams.get("channel_id") || undefined;
    const channel_type = searchParams.get("channel_type") || undefined;
    const status = searchParams.get("status") || undefined;
    const priority = searchParams.get("priority") || undefined;
    const assigned_user_id = searchParams.get("assigned_user_id") || undefined;
    const assigned_team_id = searchParams.get("assigned_team_id") || undefined;
    const unread_only = searchParams.get("unread_only") === "true";
    const tag = searchParams.get("tag") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await ConversationService.listConversations(context, {
      channel_id,
      channel_type,
      status,
      priority,
      assigned_user_id,
      assigned_team_id,
      unread_only,
      tag,
      search,
      limit,
      offset,
    });

    return apiSuccess(result.conversations, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}
