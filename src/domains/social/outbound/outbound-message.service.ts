import { AppError, BadRequestError, NotFoundError, FeatureNotEntitledError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Message, MessageType, ProductCard } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ChannelService } from "../channels/channel.service";
import { ChannelPolicyService } from "../channels/policy.service";
import { ChannelRateLimiter } from "./rate-limiter";
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { ConversationControlService } from "../conversations/conversation-control.service";
import { agentPaused, controlOf, legacyFields } from "../conversations/conversation-control.state";
import { CONTROL_V2_FLAG, strictFlag } from "@/domains/ai/customer-agent/jobs";
import { deliverMessage, INLINE_GRACE_MS } from "./outbound-delivery";

export interface SendOutboundPayload {
  text: string;
  messageType?: MessageType;
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  templateName?: string;
  templateParameters?: Record<string, string>;
  /** Product cards (channels with sendProductCards only); `text` is their plain-text form for the inbox. */
  productCards?: ProductCard[];
  replyToMessageId?: string;
  idempotency_key?: string;
  client_message_id?: string;
}

export class OutboundMessageService {
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
    options: {
      asAgent?: boolean;
      agentTurnStartedAt?: string;
      agentHandedOff?: boolean;
      traceId?: string;
      /** The turn's lease (ADR-121 S2): the chat's control version when the job was claimed, and the job id. */
      agentLease?: { version: number; turnId: string };
    } = {}
  ): Promise<Message> {
    const prepared = await db.unit(async () => {
      RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);

      if (payload.productCards && !payload.productCards.length) throw new BadRequestError("No product cards to send.");
      if (!payload.text && !payload.mediaUrl && !payload.templateName && !payload.productCards) {
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
      if (payload.productCards && !ChannelService.getAdapter(channel.type).sendProductCards) {
        throw new AppError("PRODUCT_CARDS_UNSUPPORTED", `${channel.type} chats can't show product cards.`, 422);
      }
      if (!isFeatureEnabled("real_messaging", context.tenant.id)) throw new FeatureNotEntitledError("real_messaging");

      if (options.asAgent && options.agentLease && strictFlag(CONTROL_V2_FLAG, context.tenant.id)) {
        // ADR-121 S2: one rule. The chat is still the agent's at the version the turn was claimed with, or the only change
        // since is this turn's own handoff/escalation (its one reply). Staff replies and pauses bump the version.
        const { version, turnId } = options.agentLease;
        const control = controlOf(conversation);
        const leased = control.version === version ? control.state === "BOT" : control.version === version + 1 && control.changed_by === `turn:${turnId}`;
        if (!leased) throw new AppError("AGENT_SUPERSEDED", "The conversation changed hands during the agent's turn; the agent's reply was not sent.", 409);
      } else if (options.asAgent && options.agentTurnStartedAt) {
        const since = options.agentTurnStartedAt;
        const staffReplied = db
          .getMessages(context.tenant.id, conversationId, { limit: 50 })
          .messages.some((m) => m.direction === "OUTBOUND" && m.sender_type === "AGENT" && m.message_type !== "INTERNAL_NOTE" && m.created_at >= since);
        if (staffReplied) throw new AppError("AGENT_SUPERSEDED", "A team member replied during the agent's turn; the agent's reply was not sent.", 409);
        // Paused by staff or another handoff while the turn ran: only this turn's own handoff acknowledgement may go out
        if (agentPaused(conversation) && !options.agentHandedOff) {
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
      // The agent's reply waits in the outbox for the burst limit (ADR-122): no second model call, no 429 to the worker
      const deferUntil = !rateCheck.allowed && options.asAgent ? new Date(Date.now() + Math.max(200, rateCheck.retryAfterMs ?? 0)).toISOString() : undefined;
      if (!rateCheck.allowed && !deferUntil) {
        // 429 with its own code: a burst limit passes in milliseconds, so senders retry instead of giving up
        throw new AppError("CHANNEL_RATE_LIMITED", `Channel '${channel.name}' is temporarily rate-limited. Retry in ${rateCheck.retryAfterMs}ms.`, 429, {
          retry_after_ms: rateCheck.retryAfterMs ?? 0,
          retry_after_sec: Math.max(1, Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)),
        });
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
        message_type: payload.messageType || (payload.productCards ? "PRODUCT" : payload.mediaUrl ? "IMAGE" : "TEXT"),
        text: payload.text || "",
        status: "QUEUED",
        reply_to_message_id: payload.replyToMessageId,
        retry_count: 0,
        // The request sends it first; the delivery pass takes over only after INLINE_GRACE_MS (or when deferred)
        delivery: {
          attempts: 0,
          next_attempt_at: deferUntil ?? new Date(Date.now() + INLINE_GRACE_MS).toISOString(),
          ...(deferUntil ? { last_error_code: "CHANNEL_RATE_LIMITED" } : {}),
          ...(options.asAgent ? { agent: { lease: options.agentLease, handed_off: Boolean(options.agentHandedOff) } } : {}),
          ...(payload.templateName || payload.mediaUrl || payload.replyToMessageId
            ? { request: { templateName: payload.templateName, templateParameters: payload.templateParameters, mediaUrl: payload.mediaUrl, mediaType: payload.mediaType, replyToMessageId: payload.replyToMessageId } }
            : {}),
        },
        metadata: {
          agent_name: context.user.name,
          agent_email: context.user.email,
          channel_type: channel.type,
          ...(options.traceId ? { trace_id: options.traceId } : {}),
          ...(payload.productCards ? { product_cards: payload.productCards } : {}),
        },
        created_at: now,
        updated_at: now,
      };

      db.createMessage(initialMessage);
      // A handed-off chat keeps waiting for a person, even after the bot's "a team member will reply" message
      const agentAfterHandoff = Boolean(options.asAgent && agentPaused(conversation));
      // A staff reply takes the chat (ADR-121); an agent reply leaves ownership as it is
      if (!options.asAgent) {
        ConversationControlService.transition(context.tenant.id, conversationId, "HUMAN", `user:${context.user.id}`, "staff_reply", { ownerUserId: context.user.id });
      }
      db.updateConversation(context.tenant.id, conversationId, {
        // A staff reply answers whatever was waiting for a person
        ...(options.asAgent ? (agentAfterHandoff ? {} : legacyFields("BOT")) : { awaiting_since: undefined, awaiting_count: 0 }),
        status: !agentAfterHandoff && conversation.status === "WAITING_AGENT" ? "WAITING_CUSTOMER" : conversation.status,
        last_outbound_at: now,
        last_message_at: now,
        ...(options.asAgent ? {} : { unread_count: 0 }), // staff haven't read it just because the bot answered
      });
      return { messageId: msgId, deferred: Boolean(deferUntil) };
    }, (result) => Boolean(result));

    if ("existing" in prepared && prepared.existing) return prepared.existing;
    const queued = () => db.findMessageById(context.tenant.id, prepared.messageId) as Message;
    // Deferred by the burst limit: the delivery pass sends it when it is due
    if (prepared.deferred) return queued();
    return (await deliverMessage(context.tenant.id, prepared.messageId, { inline: true })) ?? queued();
  }
}
