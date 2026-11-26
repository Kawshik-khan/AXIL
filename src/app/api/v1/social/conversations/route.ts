import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { INBOX_QUEUE_FILTERS } from "@/domains/social/conversations/inbox-queue";
import { parseOrThrow } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";
import { z } from "zod";

/** `view=inbox`: the inbox list (queue, owner, last message and counts). Without it, the plain list as before. */
const InboxQuery = z.object({
  /** One chat: how the page keeps the open chat current when it isn't in the listed queue. */
  id: z.string().max(200).optional(),
  queue: z.enum(INBOX_QUEUE_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

async function handleGET(request: Request) {
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

    if (searchParams.get("view") === "inbox") {
      const query = parseOrThrow(InboxQuery, {
        id: searchParams.get("id") || undefined,
        queue: searchParams.get("queue") || undefined,
        limit: searchParams.get("limit") || undefined,
        offset: searchParams.get("offset") || undefined,
      });
      const inbox = await ConversationService.listInbox(context, { ...query, channel_type, unread_only, tag, search });
      return apiSuccess(inbox.conversations, { ...inbox.meta });
    }

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

export const GET = withStore("GET", handleGET);
