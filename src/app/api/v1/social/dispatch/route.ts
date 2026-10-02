import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { assertN8nCallback } from "@/domains/social/n8n/bridge";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";
import { SocialEventService } from "@/domains/social/events/social-event.service";
import { logger } from "@/lib/logger";

/**
 * n8n -> CommerceOS: deliver a stored message now (connector plan C3).
 *
 * n8n POSTs {"message_id": "..."} here when it's time to send. The message and channel rows are authoritative
 * for the tenant and the credentials. The request is authenticated by the n8n callback token.
 *
 * This sends the EXISTING stored message — it does not create a new one. The message content, recipient,
 * and credentials all come from the stored rows.
 */

const DispatchBody = z.object({
  message_id: z.string().min(1),
});

async function handlePOST(request: Request) {
  await assertN8nCallback(request);

  const body = await request.json();
  const { message_id } = DispatchBody.parse(body);

  // The message row is authoritative for the tenant.
  const message = db.findMessageForDispatch(message_id);
  if (!message) {
    throw new NotFoundError(`Message '${message_id}' not found.`);
  }

  // Find the channel from the message's conversation.
  const conversation = db.findConversationById(message.tenant_id, message.conversation_id);
  if (!conversation) {
    throw new NotFoundError(`Conversation '${message.conversation_id}' not found.`);
  }
  const channel = db.findConnectedChannelById(message.tenant_id, conversation.channel_id);
  if (!channel) {
    throw new NotFoundError(`Channel '${conversation.channel_id}' not found.`);
  }

  const adapter = ChannelService.getAdapter(channel.type);
  const credentials = ChannelService.getDecryptedCredentials(channel);

  // Resolve external recipient ID
  const identity = db.getCustomerIdentities(message.tenant_id, conversation.customer_id).find(
    (i) => i.channel_id === channel.id
  );
  const recipientId = channel.type === "TELEGRAM"
    ? conversation.external_conversation_id
    : identity?.external_user_id || conversation.customer_id;

  const claim = await db.unit(async () => {
    const current = db.findMessageForDispatch(message_id);
    if (!current) throw new NotFoundError(`Message '${message_id}' not found.`);
    if (current.status !== "QUEUED") return { claimed: false, status: current.status };
    db.updateMessage(message.tenant_id, message_id, { status: "SENDING" });
    return { claimed: true, status: "SENDING" };
  }, () => true);
  if (!claim.claimed) {
    // n8n may redeliver a callback. A non-QUEUED message is never sent again, since the prior request's
    // response may have been lost after Telegram accepted the message.
    return NextResponse.json({ status: claim.status, message_id });
  }

  try {
    let sendResult;
    if (message.message_type === "TEXT" || !message.text) {
      sendResult = await adapter.sendTextMessage(credentials, recipientId, message.text);
    } else {
      sendResult = await adapter.sendTextMessage(credentials, recipientId, message.text);
    }

    const updated = await db.unit(async () => {
      const saved = db.updateMessage(message.tenant_id, message_id, {
        status: "SENT",
        external_message_id: sendResult.externalMessageId,
        sent_at: new Date().toISOString(),
        provider_timestamp: sendResult.providerTimestamp || new Date().toISOString(),
      });
      SocialEventService.emit({
        tenantId: message.tenant_id,
        eventType: "message.sent",
        aggregateType: "message",
        aggregateId: message_id,
        actor: { type: "SYSTEM", id: "n8n" },
        payload: { messageId: message_id, conversationId: message.conversation_id, channelType: channel.type, text: saved.text, recipientId },
      });
      return saved;
    }, () => true);

    return NextResponse.json({ status: "SENT", message_id: message_id, external_message_id: sendResult.externalMessageId });
  } catch (err) {
    const failedMsg = await db.unit(async () => {
      const saved = db.updateMessage(message.tenant_id, message_id, {
        status: "FAILED",
        failed_at: new Date().toISOString(),
        failure_reason: err instanceof Error ? err.message : "Provider transmission failed",
      });
      SocialEventService.emit({
        tenantId: message.tenant_id,
        eventType: "message.failed",
        aggregateType: "message",
        aggregateId: message_id,
        actor: { type: "SYSTEM", id: "n8n" },
        payload: { messageId: message_id, error: saved.failure_reason },
      });
      return saved;
    }, () => true);

    logger.warn("social.dispatch_failed", { message_id, error: err instanceof Error ? err.message : "Error" });
    return NextResponse.json({ status: "FAILED", message_id: message_id, error: failedMsg.failure_reason }, { status: 200 });
  }
}

export const POST = withStore("POST", handlePOST, { unit: false });
