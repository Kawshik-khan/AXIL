import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { withStore } from "@/lib/store-unit";

const ConversationPatch = z
  .object({
    status: z.enum(["OPEN", "PENDING", "WAITING_CUSTOMER", "WAITING_AGENT", "RESOLVED", "CLOSED", "SPAM"]),
    automation_paused: z.boolean(),
  })
  .partial()
  .strict();

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const conversation = await ConversationService.getConversationById(context, params.id);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(ConversationPatch, await readJson(request));

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

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
