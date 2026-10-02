import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { MessageService } from "@/domains/social/messages/message.service";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
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

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const idempotencyKey = request.headers.get("x-idempotency-key") || body.idempotency_key;

    const message = await OutboundMessageService.sendMessage(context, params.id, {
      ...body,
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
