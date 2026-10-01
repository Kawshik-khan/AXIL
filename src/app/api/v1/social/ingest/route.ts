import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { assertN8nCallback } from "@/domains/social/n8n/bridge";
import { CanonicalInboundSchema } from "@/domains/social/n8n/envelope";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

/**
 * n8n -> CommerceOS: the normalized result for one raw provider event (connector plan C3).
 *
 * n8n POSTs here after processing a "raw" webhook. The channel_id in the body identifies the channel; the channel
 * row is authoritative for the tenant. The request is authenticated by the n8n callback token (assertN8nCallback).
 */

const IngestBody = z.object({
  schema: z.literal("commerceos.social.message.v1"),
  channel_id: z.string().min(1),
  event_id: z.string().min(1),
  messages: z.array(z.unknown()).default([]),
  statuses: z.array(z.unknown()).default([]),
});

async function handlePOST(request: Request) {
  // Authenticate the callback: fails closed when no token is configured.
  await assertN8nCallback(request);

  const body = await request.json();
  const parsed = CanonicalInboundSchema.parse(body);

  // The channel row is authoritative for the tenant.
  const channel = db.findConnectedChannelForIngress(parsed.channel_id);
  if (!channel) {
    throw new NotFoundError(`Channel '${parsed.channel_id}' not found.`);
  }

  // Map the canonical schema to the internal types.
  const normalizedMessages = parsed.messages.map((msg: any) => ({
    channelType: channel.type,
    channelId: channel.id,
    externalEventId: parsed.event_id,
    externalMessageId: msg.external_message_id,
    externalConversationId: msg.external_conversation_id,
    externalSenderId: msg.external_sender_id,
    senderProfile: msg.sender ?? {},
    direction: "INBOUND" as const,
    messageType: msg.message_type,
    text: msg.text ?? "",
    attachments: msg.attachments ?? [],
    timestamp: msg.timestamp,
    rawPayload: msg,
  }));

  const receipts = parsed.statuses.map((st: any) => ({
    externalMessageId: st.external_message_id,
    status: st.status,
    timestamp: st.timestamp,
    failureReason: st.failure_reason,
  }));

  const result = await WebhookIngressService.ingestNormalized(channel, normalizedMessages, receipts);

  return NextResponse.json({ status: "PROCESSED", ...result });
}

export const POST = withStore("POST", handlePOST);
