/**
 * Durable outbound delivery (ADR-122, messaging reliability MR5). The message row is the outbox: the request sends right
 * away, and whatever it couldn't finish (a restart, a deploy, a sleeping instance, a rate limit) is picked up by the
 * delivery pass in the worker loop and the `outbound-redeliver` job.
 *
 * A message is resent automatically only when the provider certainly didn't take it: it was never attempted, or it was
 * refused with a rate limit. A send that may have reached the customer (a timeout, a lost response, an interrupted
 * claim) is never repeated: it becomes FAILED / DELIVERY_UNCERTAIN for a person to check. Product cards are never
 * retried (they follow a text reply that already went out).
 *
 * A send can happen long after the request that created it, so every send re-checks, at that moment, what the request
 * checked: the workspace is active, no kill switch, the messaging entitlement, the channel is active, and for an agent
 * reply that the chat is still the agent's (ADR-121). What no longer passes is not sent (FAILED or CANCELLED).
 */
import { db } from "@/infrastructure/db";
import { AppError, IntegrationNotConfiguredError, KillSwitchActiveError } from "@/lib/errors";
import { OutboundBlockedError } from "@/lib/outbound-http";
import { logger } from "@/lib/logger";
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { loadCustomerRows } from "@/infrastructure/db/tenant-rows";
import type { ConnectedChannel, Conversation, Message, MessageDelivery, ProductCard } from "@/types/social";
import { ChannelService } from "../channels/channel.service";
import type { ChannelCredentials, SendMessageResult } from "../channels/channel-provider.interface";
import { TelegramApiError } from "../channels/adapters/telegram.adapter";
import { SocialEventService } from "../events/social-event.service";
import { ChannelRateLimiter } from "./rate-limiter";
import { agentPaused, controlOf } from "../conversations/conversation-control.state";
import { CONTROL_V2_FLAG, strictFlag } from "@/domains/ai/customer-agent/jobs";

/** A claim (SENDING) older than this was interrupted. */
export const DELIVERY_LEASE_MS = 2 * 60_000;
/** A new message is the request's to send first; the pass waits this long before it may take it. */
export const INLINE_GRACE_MS = 30_000;
export const MAX_DELIVERY_ATTEMPTS = 8;
/** Older than this, a reply is no longer worth sending: the customer has moved on. */
export const DELIVERY_WINDOW_MS = 24 * 60 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const PER_PASS = 10;

type Outcome = "RETRY" | "PERMANENT" | "UNCERTAIN";

/** Retry only what the provider refused outright with a rate limit; anything that may have been delivered is uncertain. */
export function classifySendError(err: unknown): Outcome {
  if (err instanceof TelegramApiError) {
    if (err.telegramCode === 429) return "RETRY";
    return err.telegramCode >= 400 && err.telegramCode < 500 ? "PERMANENT" : "UNCERTAIN";
  }
  if (err instanceof IntegrationNotConfiguredError || err instanceof OutboundBlockedError) return "PERMANENT";
  if (err instanceof AppError) {
    if (err.statusCode === 429) return "RETRY";
    if (err.statusCode >= 400 && err.statusCode < 500) return "PERMANENT";
  }
  return "UNCERTAIN";
}

function retryAfterMs(err: unknown, attempts: number): number {
  const backoff = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.max(0, attempts - 1));
  if (err instanceof TelegramApiError && err.retryAfterSeconds) return Math.max(backoff, err.retryAfterSeconds * 1000);
  return backoff;
}

const iso = (ms: number) => new Date(ms).toISOString();
const codeOf = (err: unknown) => (err instanceof AppError ? err.code : "SEND_ERROR");
/** The actor of a send event: the agent for a bot reply, the member who wrote it otherwise. */
const actorOf = (m: Message) => ({ type: m.sender_type === "BOT" ? ("BOT" as const) : ("USER" as const), id: m.sender_id ?? "system:delivery" });

/** Ends a message without sending it, with one `message.failed` event. CANCELLED means it should not go out at all. */
async function settle(tenantId: string, message: Message, status: "FAILED" | "CANCELLED", reason: string, delivery: MessageDelivery): Promise<Message> {
  return db.unit(async () => {
    const saved = db.updateMessage(tenantId, message.id, {
      status,
      ...(status === "FAILED" ? { failed_at: new Date().toISOString() } : {}),
      failure_reason: reason,
      retry_count: delivery.attempts,
      delivery: { ...delivery, lease_until: undefined, next_attempt_at: undefined },
    });
    SocialEventService.emit({
      tenantId,
      eventType: "message.failed",
      aggregateType: "message",
      aggregateId: message.id,
      actor: actorOf(message),
      payload: { messageId: message.id, error: delivery.last_error_code ?? status },
    });
    return saved;
  }, () => true);
}

/**
 * What the request checked, checked again now: a queued message may go out minutes after it was stored. Returns why it
 * must not be sent, or null.
 */
function refusalNow(tenantId: string, message: Message, conversation: Conversation, channel: ConnectedChannel): { status: "FAILED" | "CANCELLED"; code: string; reason: string } | null {
  const tenant = db.findTenantById(tenantId);
  if (!tenant || tenant.status !== "ACTIVE") return { status: "FAILED", code: "TENANT_INACTIVE", reason: "The workspace isn't active; nothing was sent." };
  try {
    assertNotKilled(tenantId, "CHANNEL", channel.id, channel.type);
  } catch (err) {
    if (err instanceof KillSwitchActiveError) return { status: "FAILED", code: "KILL_SWITCH", reason: "Messaging is paused by a kill switch; nothing was sent." };
    throw err;
  }
  if (!isFeatureEnabled("real_messaging", tenantId)) return { status: "FAILED", code: "NOT_ENTITLED", reason: "Messaging isn't enabled for this workspace; nothing was sent." };
  if (channel.status !== "ACTIVE") return { status: "FAILED", code: "CHANNEL_INACTIVE", reason: "The channel isn't active; nothing was sent." };

  // An agent reply goes out only while the chat is still the agent's (ADR-121), as the request required
  if (message.sender_type === "BOT") {
    const agent = message.delivery?.agent;
    const lease = agent?.lease;
    let superseded: boolean;
    if (lease && strictFlag(CONTROL_V2_FLAG, tenantId)) {
      const control = controlOf(conversation);
      superseded = !(control.version === lease.version ? control.state === "BOT" : control.version === lease.version + 1 && control.changed_by === `turn:${lease.turnId}`);
    } else {
      const staffSince = db
        .getMessages(tenantId, conversation.id, { limit: 50 })
        .messages.some((m) => m.direction === "OUTBOUND" && m.sender_type === "AGENT" && m.message_type !== "INTERNAL_NOTE" && m.created_at >= message.created_at);
      superseded = staffSince || (agentPaused(conversation) && !agent?.handed_off);
    }
    if (superseded) return { status: "CANCELLED", code: "AGENT_SUPERSEDED", reason: "A person took the chat before this reply went out; it was not sent." };
  }
  return null;
}

/**
 * Claims one QUEUED message and sends it once. `inline` is the request that just created it (it doesn't wait for the
 * message to be due); the delivery pass only takes due ones (`now` is the pass's clock for that test). Returns the
 * message as it ends up, or the current row when it isn't this caller's to send (another server, not due).
 */
export async function deliverMessage(tenantId: string, messageId: string, opts: { inline?: boolean; now?: number } = {}): Promise<Message | undefined> {
  const dueAt = opts.now ?? Date.now();
  let claimed: Message | undefined;
  try {
    claimed = await db.unit(async () => {
      const m = db.findMessageById(tenantId, messageId);
      if (!m || m.direction !== "OUTBOUND" || m.status !== "QUEUED") return undefined;
      if (!opts.inline && Date.parse(m.delivery?.next_attempt_at ?? m.created_at) > dueAt) return undefined;
      const d = m.delivery ?? { attempts: 0 };
      // The lease runs from the claim itself, not from when a long pass started
      return db.updateMessage(tenantId, messageId, {
        status: "SENDING",
        delivery: { ...d, attempts: d.attempts + 1, lease_until: iso(Date.now() + DELIVERY_LEASE_MS), next_attempt_at: undefined },
      });
    }, (r) => Boolean(r));
  } catch (err) {
    // Another server changed it first, or the store is busy: it isn't ours to send now
    if (err instanceof AppError && (err.code === "STORE_CONFLICT" || err.code === "STORE_BUSY")) return db.findMessageById(tenantId, messageId);
    throw err;
  }
  if (!claimed) return db.findMessageById(tenantId, messageId);

  const delivery = claimed.delivery as MessageDelivery;
  const conversation = db.findConversationById(tenantId, claimed.conversation_id);
  const channel = conversation ? db.findConnectedChannelById(tenantId, conversation.channel_id) : undefined;
  if (!conversation || !channel) return settle(tenantId, claimed, "FAILED", "The conversation's channel is gone; nothing was sent.", { ...delivery, last_error_code: "NO_CHANNEL" });
  const refused = refusalNow(tenantId, claimed, conversation, channel);
  if (refused) {
    logger.warn("outbound.not_sent", { tenant_id: tenantId, message_id: claimed.id, code: refused.code });
    return settle(tenantId, claimed, refused.status, refused.reason, { ...delivery, last_error_code: refused.code });
  }

  let credentials: ChannelCredentials;
  try {
    credentials = ChannelService.getDecryptedCredentials(channel);
  } catch (err) {
    // No usable credentials: record the truth instead of attempting (or pretending) delivery (FX-03)
    return settle(tenantId, claimed, "FAILED", err instanceof Error ? err.message : "Channel credentials could not be read.", { ...delivery, last_error_code: "NO_CREDENTIALS" });
  }

  // The external recipient (PSID, phone, WhatsApp id); Telegram answers the stored chat
  await loadCustomerRows(tenantId, [conversation.customer_id]);
  const identity = db.getCustomerIdentities(tenantId, conversation.customer_id).find((i) => i.channel_id === channel.id);
  const recipientId = channel.type === "TELEGRAM" ? conversation.external_conversation_id : identity?.external_user_id || conversation.customer_id;

  const adapter = ChannelService.getAdapter(channel.type);
  const request = delivery.request ?? {};
  const productCards = Array.isArray(claimed.metadata?.product_cards) ? (claimed.metadata.product_cards as ProductCard[]) : undefined;
  let sendResult: SendMessageResult;
  try {
    sendResult =
      productCards && adapter.sendProductCards
        ? await adapter.sendProductCards(credentials, recipientId, productCards)
        : request.templateName
          ? await adapter.sendTemplateMessage(credentials, recipientId, request.templateName, request.templateParameters || {})
          : request.mediaUrl
            ? await adapter.sendMediaMessage(credentials, recipientId, request.mediaType || "IMAGE", request.mediaUrl)
            : await adapter.sendTextMessage(credentials, recipientId, claimed.text, { replyToMessageId: request.replyToMessageId });
  } catch (err) {
    return afterSendError(tenantId, claimed, delivery, channel, err);
  }

  // The provider took it. Recording that is a store write, never a provider outcome: if it fails, the row stays
  // SENDING and later reads as uncertain, so nobody is told it failed and resends it.
  try {
    // WhatsApp sends one message per card and stops early on a failure: keep only the cards that went out
    const sentIds = sendResult.rawResponse?.message_ids;
    const sentCards = productCards && Array.isArray(sentIds) && sentIds.length < productCards.length ? productCards.slice(0, sentIds.length) : undefined;
    return await db.unit(async () => {
      const saved = db.updateMessage(tenantId, claimed.id, {
        ...(sentCards ? { metadata: { ...claimed.metadata, product_cards: sentCards } } : {}),
        status: "SENT",
        external_message_id: sendResult.externalMessageId,
        sent_at: new Date().toISOString(),
        provider_timestamp: sendResult.providerTimestamp || new Date().toISOString(),
        retry_count: delivery.attempts - 1,
        delivery: { ...delivery, lease_until: undefined, last_error_code: undefined },
      });
      SocialEventService.emit({
        tenantId,
        eventType: "message.sent",
        aggregateType: "message",
        aggregateId: claimed.id,
        actor: actorOf(claimed),
        payload: { messageId: claimed.id, conversationId: saved.conversation_id, channelType: channel.type, text: saved.text, recipientId },
      });
      return saved;
    }, () => true);
  } catch (err) {
    logger.error("outbound.record_failed", { tenant_id: tenantId, message_id: claimed.id, code: codeOf(err) });
    return db.findMessageById(tenantId, claimed.id);
  }
}

async function afterSendError(tenantId: string, claimed: Message, delivery: MessageDelivery, channel: ConnectedChannel, err: unknown): Promise<Message> {
  const productCards = Array.isArray(claimed.metadata?.product_cards);
  const classified = classifySendError(err);
  const outcome = productCards && classified === "RETRY" ? "PERMANENT" : classified;
  const code = codeOf(err);
  const expired = Date.now() - Date.parse(claimed.created_at) > DELIVERY_WINDOW_MS;
  if (outcome === "RETRY" && delivery.attempts < MAX_DELIVERY_ATTEMPTS && !expired) {
    const next = iso(Date.now() + retryAfterMs(err, delivery.attempts));
    logger.info("outbound.requeued", { tenant_id: tenantId, message_id: claimed.id, attempt: delivery.attempts, code, next_attempt_at: next });
    return db.unit(async () => db.updateMessage(tenantId, claimed.id, {
      status: "QUEUED",
      retry_count: delivery.attempts,
      delivery: { ...delivery, lease_until: undefined, next_attempt_at: next, last_error_code: code },
    }), () => true);
  }
  if (outcome === "RETRY") {
    logger.warn("outbound.dead_lettered", { tenant_id: tenantId, message_id: claimed.id, attempts: delivery.attempts, code });
    return settle(tenantId, claimed, "FAILED", `Not delivered after ${delivery.attempts} attempts (${code}).`, { ...delivery, last_error_code: code, dead_lettered_at: new Date().toISOString() });
  }
  if (outcome === "UNCERTAIN") {
    // Only our own error codes go into the reason the inbox shows: never a provider's or the store's text
    return settle(tenantId, claimed, "FAILED", `DELIVERY_UNCERTAIN: the send may have reached the customer (${code}). Check the chat before resending.`, { ...delivery, last_error_code: "DELIVERY_UNCERTAIN" });
  }
  const reason =
    channel.type === "TELEGRAM" && err instanceof TelegramApiError && err.telegramCode === 429
      ? `Telegram rate limited this bot. Retry after ${err.retryAfterSeconds ?? 1} seconds.`
      : err instanceof Error ? err.message : "Provider transmission failed";
  return settle(tenantId, claimed, "FAILED", reason, { ...delivery, last_error_code: code });
}

export interface DeliveryPassStats {
  sent: number;
  /** Due but left for a later pass: the channel's burst limit, another server claimed it, or it errored. */
  skipped: number;
  requeued: number;
  failed: number;
  /** Not sent because the workspace, channel or chat no longer allows it (kill switch, inactive, a person took it). */
  refused: number;
  uncertain: number;
  expired: number;
}

/**
 * One delivery pass: interrupted claims become uncertain (never resent), due messages are sent, at most one per
 * conversation and PER_PASS in all, oldest first. Safe on several servers: every claim is a version-checked write.
 * A message that throws is skipped and logged; the rest of the pass goes on.
 */
export async function runDeliveriesOnce(now = Date.now()): Promise<DeliveryPassStats> {
  const stats: DeliveryPassStats = { sent: 0, skipped: 0, requeued: 0, failed: 0, refused: 0, uncertain: 0, expired: 0 };
  const pending = db.getUndeliveredOutboundMessages();

  for (const m of pending.filter((x) => x.status === "SENDING")) {
    const lease = m.delivery?.lease_until ?? iso(Date.parse(m.updated_at) + DELIVERY_LEASE_MS);
    if (Date.parse(lease) > now) continue;
    try {
      const marked = await db.unit(async () => {
        const current = db.findMessageById(m.tenant_id, m.id);
        if (!current || current.status !== "SENDING" || (current.delivery?.lease_until ?? lease) !== lease) return undefined;
        return current;
      }, () => true);
      if (!marked) continue;
      await settle(m.tenant_id, marked, "FAILED", "DELIVERY_UNCERTAIN: the send was interrupted and may have reached the customer. Check the chat before resending.", {
        ...(marked.delivery ?? { attempts: 1 }),
        last_error_code: "DELIVERY_UNCERTAIN",
      });
      stats.uncertain++;
      logger.warn("outbound.delivery_uncertain", { tenant_id: m.tenant_id, message_id: m.id });
    } catch (err) {
      stats.skipped++;
      logger.warn("outbound.pass_error", { tenant_id: m.tenant_id, message_id: m.id, code: codeOf(err) });
    }
  }

  const seen = new Set<string>();
  const due = pending.filter((x) => {
    if (x.status !== "QUEUED" || seen.has(x.conversation_id)) return false;
    const at = x.delivery?.next_attempt_at ?? iso(Date.parse(x.created_at) + INLINE_GRACE_MS);
    if (Date.parse(at) > now) return false;
    seen.add(x.conversation_id);
    return true;
  });
  for (const m of due.slice(0, PER_PASS)) {
    try {
      if (now - Date.parse(m.created_at) > DELIVERY_WINDOW_MS) {
        await settle(m.tenant_id, m, "FAILED", "Not delivered within 24 hours; not sent so late.", { ...(m.delivery ?? { attempts: 0 }), last_error_code: "EXPIRED", dead_lettered_at: new Date(now).toISOString() });
        stats.expired++;
        continue;
      }
      // The channel's burst limit applies to the pass too: what it refuses waits for the next pass
      const channelId = db.findConversationById(m.tenant_id, m.conversation_id)?.channel_id;
      if (channelId && !ChannelRateLimiter.tryConsume(channelId).allowed) {
        stats.skipped++;
        continue;
      }
      const attemptsBefore = m.delivery?.attempts ?? 0;
      const result = await deliverMessage(m.tenant_id, m.id, { now });
      if (!result || (result.status === "QUEUED" && (result.delivery?.attempts ?? 0) === attemptsBefore)) stats.skipped++;
      else if (result.status === "SENT") stats.sent++;
      else if (result.status === "QUEUED") stats.requeued++;
      else if (result.status === "CANCELLED" || ["TENANT_INACTIVE", "KILL_SWITCH", "NOT_ENTITLED", "CHANNEL_INACTIVE"].includes(result.delivery?.last_error_code ?? "")) stats.refused++;
      else if (result.delivery?.last_error_code === "DELIVERY_UNCERTAIN") stats.uncertain++;
      else stats.failed++;
    } catch (err) {
      stats.skipped++;
      logger.warn("outbound.pass_error", { tenant_id: m.tenant_id, message_id: m.id, code: codeOf(err) });
    }
  }
  return stats;
}
