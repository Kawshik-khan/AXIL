import { AppError, IntegrationNotConfiguredError, BadRequestError, NotFoundError, FeatureNotEntitledError } from "@/lib/errors";
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
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { enqueueSendInN8n, isSocialChannel, socialN8nEnabled } from "../n8n/bridge";
import { logger } from "@/lib/logger";
import { TelegramApiError } from "../channels/adapters/telegram.adapter";

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

  /**
   * `asAgent` (the customer agent, FX-76): the message is the bot's (sender BOT). It never takes a chat back from people:
   * after a handoff (automation paused) the mode and status stay as the handoff left them, and when staff replied after
   * `agentTurnStartedAt`, or the chat was paused by anyone but this turn's own handoff, the bot's reply is refused
 * (409 AGENT_SUPERSEDED, ADR-112).
   * A person replying takes the conversation over (HUMAN mode, automation paused), as before.
   */
  public static async sendMessage(
    context: RequestContext,
    conversationId: string,
    payload: SendOutboundPayload,
    options: { asAgent?: boolean; agentTurnStartedAt?: string; agentHandedOff?: boolean } = {}
  ): Promise<Message> {
    const prepared = await db.unit(async () => {
      RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);

      if (!payload.text && !payload.mediaUrl && !payload.templateName) {
        throw new BadRequestError("Message must contain text, media, or template.");
      }
      if (payload.messageType === "INTERNAL_NOTE") {
        throw new BadRequestError("Internal notes cannot be sent to customers.");
      }

      const conversation = db.findConversationById(context.tenant.id, conversationId);
      if (!conversation) throw new NotFoundError(`Conversation '${conversationId}' not found.`);
      const channel = db.findConnectedChannelById(context.tenant.id, conversation.channel_id);
      if (!channel) throw new BadRequestError(`Connected channel '${conversation.channel_id}' not found or disconnected.`);
      assertNotKilled(context.tenant.id, "CHANNEL", channel.id, channel.type);
      if (!isFeatureEnabled("real_messaging", context.tenant.id)) throw new FeatureNotEntitledError("real_messaging");

      if (options.asAgent && options.agentTurnStartedAt) {
        const since = options.agentTurnStartedAt;
        const staffReplied = db
          .getMessages(context.tenant.id, conversationId, { limit: 50 })
          .messages.some((m) => m.direction === "OUTBOUND" && m.sender_type === "AGENT" && m.message_type !== "INTERNAL_NOTE" && m.created_at >= since);
        if (staffReplied) throw new AppError("AGENT_SUPERSEDED", "A team member replied during the agent's turn; the agent's reply was not sent.", 409);
        // Paused by staff or another handoff while the turn ran: only this turn's own handoff acknowledgement may go out
        if (conversation.automation_paused && !options.agentHandedOff) {
          throw new AppError("AGENT_SUPERSEDED", "The conversation was taken over during the agent's turn; the agent's reply was not sent.", 409);
        }
      }

      const key = payload.idempotency_key || payload.client_message_id;
      if (key) {
        const existing = db.findMessageByIdempotencyKey(context.tenant.id, key);
        if (existing) return { existing };
      }

      ChannelPolicyService.assertCanSend(channel.type, conversation.last_inbound_at, payload.messageType || "TEXT", payload.text);
      const rateCheck = ChannelRateLimiter.tryConsume(channel.id);
      if (!rateCheck.allowed) {
        throw new BadRequestError(`Channel '${channel.name}' is temporarily rate-limited. Retry in ${rateCheck.retryAfterMs}ms.`);
      }

      const msgId = `msg_${Date.now()}_${randomSuffix()}`;
      const now = new Date().toISOString();
      const initialMessage: Message = {
        id: msgId,
        tenant_id: context.tenant.id,
        conversation_id: conversationId,
        client_message_id: payload.client_message_id,
        idempotency_key: payload.idempotency_key,
        direction: "OUTBOUND",
        sender_type: options.asAgent ? "BOT" : "AGENT",
        sender_id: context.user.id,
        message_type: payload.messageType || (payload.mediaUrl ? "IMAGE" : "TEXT"),
        text: payload.text || "",
        status: "QUEUED",
        reply_to_message_id: payload.replyToMessageId,
        retry_count: 0,
        metadata: { agent_name: context.user.name, agent_email: context.user.email, channel_type: channel.type },
        created_at: now,
        updated_at: now,
      };

      db.createMessage(initialMessage);
      // A handed-off chat keeps waiting for a person, even after the bot's "a team member will reply" message
      const agentAfterHandoff = Boolean(options.asAgent && conversation.automation_paused);
      db.updateConversation(context.tenant.id, conversationId, {
        ...(options.asAgent ? (agentAfterHandoff ? {} : { mode: "AI" as const }) : { automation_paused: true, mode: "HUMAN" as const }),
        status: !agentAfterHandoff && conversation.status === "WAITING_AGENT" ? "WAITING_CUSTOMER" : conversation.status,
        last_outbound_at: now,
        last_message_at: now,
        ...(options.asAgent ? {} : { unread_count: 0 }), // staff haven't read it just because the bot answered
      });
      return { channel, customerId: conversation.customer_id, externalConversationId: conversation.external_conversation_id, messageId: msgId };
    }, (result) => Boolean(result));

    if ("existing" in prepared && prepared.existing) return prepared.existing;
    return this.transmitWithRetry(context, prepared.channel, prepared.customerId, prepared.externalConversationId, prepared.messageId, payload);
  }

  private static async transmitWithRetry(
    context: RequestContext,
    channel: import("@/types/social").ConnectedChannel,
    customerId: string,
    externalConversationId: string,
    messageId: string,
    payload: SendOutboundPayload
  ): Promise<Message> {
    // n8n is the preferred path for social channels (connector plan C3): it schedules, waits for the 24-hour
    // window, retries, and then calls back to /api/v1/social/dispatch. When n8n is unavailable, CommerceOS
    // delivers directly so a customer's message is never lost.
    if (socialN8nEnabled() && isSocialChannel(channel.type)) {
      try {
        await enqueueSendInN8n({
          messageId,
          channel,
          sendAt: null,
          idempotencyKey: payload.idempotency_key || messageId,
        });
        // The message stays QUEUED; n8n will dispatch it and the dispatch route will update the status.
        return db.findMessageById(context.tenant.id, messageId) ?? (await db.updateMessage(context.tenant.id, messageId, { status: "QUEUED" }));
      } catch (err) {
        // n8n couldn't take it: fall through to direct delivery
        logger.warn("social.n8n_send_fallback", { message_id: messageId, error: err instanceof Error ? err.name : "Error" });
      }
    }

    const adapter = ChannelService.getAdapter(channel.type);
    let credentials: ChannelCredentials;
    try {
      credentials = ChannelService.getDecryptedCredentials(channel);
    } catch (err) {
      // No usable credentials: record the truth instead of attempting (or pretending) delivery (FX-03, rules/truthfulness.md).
      return db.unit(async () => db.updateMessage(context.tenant.id, messageId, {
        status: "FAILED", failed_at: new Date().toISOString(),
        failure_reason: err instanceof Error ? err.message : "Channel credentials could not be read.",
      }), () => true);
    }

    // Resolve external recipient ID (e.g. PSID, Phone, WhatsApp ID)
    const identity = db.getCustomerIdentities(context.tenant.id, customerId).find(
      (i) => i.channel_id === channel.id
    );
    const recipientId = channel.type === "TELEGRAM"
      ? externalConversationId
      : identity?.external_user_id || customerId;

    let attempts = 0;
    let lastError: Error | null = null;

    await db.unit(async () => db.updateMessage(context.tenant.id, messageId, { status: "SENDING" }), () => true);

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

        const updated = await db.unit(async () => {
          const saved = db.updateMessage(context.tenant.id, messageId, {
            status: "SENT",
            external_message_id: sendResult.externalMessageId,
            sent_at: new Date().toISOString(),
            provider_timestamp: sendResult.providerTimestamp || new Date().toISOString(),
            retry_count: attempts - 1,
          });
          SocialEventService.emit({
            tenantId: context.tenant.id,
            eventType: "message.sent",
            aggregateType: "message",
            aggregateId: messageId,
            actor: { type: "USER", id: context.user.id },
            payload: { messageId, conversationId: saved.conversation_id, channelType: channel.type, text: saved.text, recipientId },
          });
          return saved;
        }, () => true);

        return updated;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof IntegrationNotConfiguredError) break; // retrying can't help (FX-31)
        // Telegram sendMessage has no idempotency key. A timeout or lost response may follow an accepted message,
        // so never automatically repeat it; a human can inspect Telegram before choosing to retry.
        if (channel.type === "TELEGRAM") break;
        if (attempts < this.MAX_RETRIES) {
          // Exponential backoff: 200ms * 2^(attempt-1)
          const backoffMs = 200 * Math.pow(2, attempts - 1);
          await new Promise((res) => setTimeout(res, backoffMs));
        }
      }
    }

    // Permanently failed
    const failureReason = channel.type === "TELEGRAM" && lastError instanceof TelegramApiError && lastError.telegramCode === 429
      ? `Telegram rate limited this bot. Retry after ${lastError.retryAfterSeconds ?? 1} seconds.`
      : lastError?.message || "Provider transmission failed after retries";
    const failedMsg = await db.unit(async () => {
      const saved = db.updateMessage(context.tenant.id, messageId, {
        status: "FAILED", failed_at: new Date().toISOString(), failure_reason: failureReason, retry_count: attempts,
      });
      SocialEventService.emit({
        tenantId: context.tenant.id,
        eventType: "message.failed",
        aggregateType: "message",
        aggregateId: messageId,
        actor: { type: "USER", id: context.user.id },
        payload: { messageId, error: saved.failure_reason },
      });
      return saved;
    }, () => true);

    return failedMsg;
  }
}
