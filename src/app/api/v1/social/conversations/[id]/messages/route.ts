import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { MessageService } from "@/domains/social/messages/message.service";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
import { parseOrThrow } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const cursor = searchParams.get("cursor") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const direction = (searchParams.get("direction") as "before" | "after") || undefined;

    const result = await MessageService.listMessages(context, params.id, {
      cursor,
      limit,
      direction,
    });

    return apiSuccess(result.messages, {
      total: result.total,
      nextCursor: result.nextCursor,
      prevCursor: result.prevCursor,
    });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * What staff may send. Product cards are not here: only the customer agent sends them, built from the catalog, so a
 * card can't carry a typed price (non-negotiable 5). Unknown fields are a 400 (audit H4).
 */
const SendBody = z
  .object({
    text: z.string().max(4096).optional(),
    messageType: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE"]).optional(),
    mediaUrl: z.string().url().max(2000).optional(),
    mediaType: z.enum(["IMAGE", "VIDEO", "AUDIO", "FILE"]).optional(),
    templateName: z.string().max(512).optional(),
    templateParameters: z.record(z.string().max(1024)).optional(),
    replyToMessageId: z.string().max(200).optional(),
    idempotency_key: z.string().max(200).optional(),
    client_message_id: z.string().max(100).optional(),
  })
  .strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(SendBody, await request.json());

    const idempotencyKey = request.headers.get("x-idempotency-key") || body.idempotency_key;

    const message = await OutboundMessageService.sendMessage(context, params.id, {
      text: body.text ?? "",
      messageType: body.messageType,
      mediaUrl: body.mediaUrl,
      mediaType: body.mediaType,
      templateName: body.templateName,
      templateParameters: body.templateParameters,
      replyToMessageId: body.replyToMessageId,
      client_message_id: body.client_message_id,
      idempotency_key: idempotencyKey,
    });

    return apiSuccess({ message }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
// OutboundMessageService commits queue/status changes in short units; provider calls must stay outside the store lock.
export const POST = withStore("POST", handlePOST, { unit: false });
