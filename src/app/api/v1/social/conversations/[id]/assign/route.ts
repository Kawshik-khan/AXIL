import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { withStore } from "@/lib/store-unit";

const AssignBody = z
  .object({
    assigned_user_id: z.string().min(1).max(200).optional(),
    assigned_team_id: z.enum(["SALES", "SUPPORT", "ORDERS", "RETURNS", "FINANCE", "GENERAL"]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(AssignBody, await readJson(request));

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

export const POST = withStore("POST", handlePOST);
