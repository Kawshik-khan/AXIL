import { IntegrationNotConfiguredError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Message, MessageType } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ChannelService } from "../channels/channel.service";
import { ChannelCredentials } from "../channels/channel-provider.interface";
import { ChannelPolicyService } from "../channels/policy.service";
import { ChannelRateLimiter } from "./rate-limiter";
import { SocialEventService } from "../events/social-event.service";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { FeatureNotEntitledError } from "@/lib/errors";

export interface SendOutboundPayload {
  text: string;
  messageType?: MessageType;
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  templateName?: string;
  templateParameters?: Record<string, string>;
  replyToMessageId?: string;
  idempotency_key?: string;
  client_message_id?: string;
}

export class OutboundMessageService {
  private static readonly MAX_RETRIES = 4;

  public static async sendMessage(
    context: RequestContext,
    conversationId: string,
    payload: SendOutboundPayload
  ): Promise<Message> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);

    if (!payload.text && !payload.mediaUrl && !payload.templateName) {
      throw new BadRequestError("Message must contain text, media, or template.");
    }

    if (payload.messageType === "INTERNAL_NOTE") {
      throw new BadRequestError("Internal notes cannot be sent to customers.");
    }

    const conversation = db.findConversationById(context.tenant.id, conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation '${conversationId}' not found.`);
    }

    const channel = db.findConnectedChannelById(context.tenant.id, conversation.channel_id);
    if (!channel) {
      throw new BadRequestError(`Connected channel '${conversation.channel_id}' not found or disconnected.`);
    }
    assertNotKilled(context.tenant.id, "CHANNEL", channel.id, channel.type); // FX-34
    if (!isFeatureEnabled("real_messaging", context.tenant.id)) {
      throw new FeatureNotEntitledError("real_messaging"); // outbound messaging behind its platform flag (FX-34 step 4)
    }

    // 1. Idempotency Check
    const key = payload.idempotency_key || payload.client_message_id;
    if (key) {
      const existing = db.findMessageByIdempotencyKey(context.tenant.id, key);
      if (existing) {
        return existing;
      }
    }

    // 2. Channel Policy Check (e.g. 24-hour Meta window & character limits)
    ChannelPolicyService.assertCanSend(
      channel.type,
      conversation.last_inbound_at,
      payload.messageType || "TEXT",
      payload.text
    );

    // 3. Rate Limiter
    const rateCheck = ChannelRateLimiter.tryConsume(channel.id);
    if (!rateCheck.allowed) {
      throw new BadRequestError(
        `Channel '${channel.name}' is temporarily rate-limited. Retry in ${rateCheck.retryAfterMs}ms.`
      );
    }

    // 4. Create Message Record in QUEUED state
    const msgId = `msg_${Date.now()}_${randomSuffix()}`;
    const initialMessage: Message = {
      id: msgId,
      tenant_id: context.tenant.id,
      conversation_id: conversationId,
      client_message_id: payload.client_message_id,
      idempotency_key: payload.idempotency_key,
      direction: "OUTBOUND",
      sender_type: "AGENT",
      sender_id: context.user.id,
      message_type: payload.messageType || (payload.mediaUrl ? "IMAGE" : "TEXT"),
      text: payload.text || "",
      status: "QUEUED",
      reply_to_message_id: payload.replyToMessageId,
      retry_count: 0,
      metadata: {
        agent_name: context.user.name,
        agent_email: context.user.email,
        channel_type: channel.type,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.createMessage(initialMessage);

    // 5. CRITICAL: Enforce Automation Lock & Human Mode on Conversation
    db.updateConversation(context.tenant.id, conversationId, {
      automation_paused: true,
      mode: "HUMAN",
      status: conversation.status === "WAITING_AGENT" ? "WAITING_CUSTOMER" : conversation.status,
      last_outbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      unread_count: 0, // Agent replied, so conversation is caught up
    });

    // 6. Transmit via Provider Adapter with Exponential Backoff
    return this.transmitWithRetry(context, channel, conversation.customer_id, msgId, payload);
  }

  private static async transmitWithRetry(
    context: RequestContext,
    channel: any,
    customerId: string,
    messageId: string,
    payload: SendOutboundPayload
  ): Promise<Message> {
    const adapter = ChannelService.getAdapter(channel.type);
    let credentials: ChannelCredentials;
    try {
      credentials = ChannelService.getDecryptedCredentials(channel);
    } catch (err) {
      // No usable credentials: record the truth instead of attempting (or pretending) delivery (FX-03, rules/truthfulness.md).
      return db.updateMessage(context.tenant.id, messageId, {
        status: "FAILED",
        failed_at: new Date().toISOString(),
        failure_reason: err instanceof Error ? err.message : "Channel credentials could not be read.",
      });
    }

    // Resolve external recipient ID (e.g. PSID, Phone, WhatsApp ID)
    const identity = db.getCustomerIdentities(context.tenant.id, customerId).find(
      (i) => i.channel_id === channel.id
    );
    const recipientId = identity?.external_user_id || customerId;

    let attempts = 0;
    let lastError: Error | null = null;

    db.updateMessage(context.tenant.id, messageId, { status: "SENDING" });

    while (attempts < this.MAX_RETRIES) {
      try {
        attempts++;
        let sendResult;

        if (payload.templateName) {
          sendResult = await adapter.sendTemplateMessage(
            credentials,
            recipientId,
            payload.templateName,
            payload.templateParameters || {}
          );
        } else if (payload.mediaUrl) {
          sendResult = await adapter.sendMediaMessage(
            credentials,
            recipientId,
            payload.mediaType || "IMAGE",
            payload.mediaUrl
          );
        } else {
          sendResult = await adapter.sendTextMessage(
            credentials,
            recipientId,
            payload.text,
            { replyToMessageId: payload.replyToMessageId }
          );
        }

        const updated = db.updateMessage(context.tenant.id, messageId, {
          status: "SENT",
          external_message_id: sendResult.externalMessageId,
          sent_at: new Date().toISOString(),
          provider_timestamp: sendResult.providerTimestamp || new Date().toISOString(),
          retry_count: attempts - 1,
        });

        // Emit outbound message event
        SocialEventService.emit({
          tenantId: context.tenant.id,
          eventType: "message.sent",
          aggregateType: "message",
          aggregateId: messageId,
          actor: { type: "USER", id: context.user.id },
          payload: {
            messageId,
            conversationId: updated.conversation_id,
            channelType: channel.type,
            text: updated.text,
            recipientId,
          },
        });

        return updated;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof IntegrationNotConfiguredError) break; // retrying can't help (FX-31)
        if (attempts < this.MAX_RETRIES) {
          // Exponential backoff: 200ms * 2^(attempt-1)
          const backoffMs = 200 * Math.pow(2, attempts - 1);
          await new Promise((res) => setTimeout(res, backoffMs));
        }
      }
    }

    // Permanently failed
    const failedMsg = db.updateMessage(context.tenant.id, messageId, {
      status: "FAILED",
      failed_at: new Date().toISOString(),
      failure_reason: lastError?.message || "Provider transmission failed after retries",
      retry_count: attempts,
    });

    SocialEventService.emit({
      tenantId: context.tenant.id,
      eventType: "message.failed",
      aggregateType: "message",
      aggregateId: messageId,
      actor: { type: "USER", id: context.user.id },
      payload: {
        messageId,
        error: failedMsg.failure_reason,
      },
    });

    return failedMsg;
  }
}
