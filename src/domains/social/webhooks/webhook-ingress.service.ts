import { db } from "@/infrastructure/db";
import { ChannelType, ConnectedChannel } from "@/types/social";
import { ChannelService, PROVIDER_ROUTED_TYPES } from "../channels/channel.service";
import { ChannelCredentials, IChannelProvider } from "../channels/channel-provider.interface";
import { logger } from "@/lib/logger";
import { checkRateLimit, MINUTE } from "@/lib/rate-limit";
import { IdentityResolutionService } from "../identity/identity-resolution.service";
import { ConversationService } from "../conversations/conversation.service";
import { MessageService } from "../messages/message.service";
import { AssignmentService } from "../assignments/assignment.service";
import { SocialEventService } from "../events/social-event.service";
import { BadRequestError, AuthenticationError } from "@/lib/errors";

export interface WebhookIngressResult {
  success: boolean;
  messagesProcessed: number;
  receiptsProcessed: number;
  channelId?: string;
  tenantId?: string;
}

type PayloadEntry = Record<string, unknown>;

/**
 * Flood cap per channel, counted only after the signature verified (FX-14 / Phase 1 review). A global pre-auth bucket
 * would let unauthenticated traffic block every tenant's webhooks.
 */
function withinChannelLimit(channel: ConnectedChannel): boolean {
  if (checkRateLimit(`social_webhook:${channel.id}`, 1200, MINUTE).allowed) return true;
  logger.warn("social_webhook.rate_limited", { tenant_id: channel.tenant_id, channel_id: channel.id });
  return false;
}

export class WebhookIngressService {
  /**
   * Process raw incoming webhook payload from Facebook, Instagram, WhatsApp, or Website
   */
  public static async handleWebhook(
    channelType: ChannelType,
    rawBody: string,
    signature: string | null,
    headers: Record<string, string | string[] | undefined>,
    channelIdOverride?: string,
    options: { unsignedWidget?: boolean } = {}
  ): Promise<WebhookIngressResult> {
    const adapter = ChannelService.getAdapter(channelType);

    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new BadRequestError("Webhook payload is not valid JSON.");
    }

    // 1. Resolve target channels strictly (audit H5): by the channel's public id, or — for Meta — by the account id
    //    of EACH entry. Meta batches events for several Pages / numbers of one app into a single request, so every
    //    entry is routed to its own channel. Unknown or ambiguous accounts are dropped; there is no fallback channel.
    const targets: Array<{ channel: ConnectedChannel; payload: Record<string, unknown> }> = [];
    if (channelIdOverride) {
      const channel = db.findConnectedChannelForIngress(channelIdOverride);
      if (channel && channel.type === channelType && channel.status === "ACTIVE") {
        targets.push({ channel, payload: parsedPayload });
      }
    } else if (PROVIDER_ROUTED_TYPES.has(channelType)) {
      const entries = Array.isArray(parsedPayload.entry) ? (parsedPayload.entry as PayloadEntry[]) : [];
      const byChannel = new Map<string, { channel: ConnectedChannel; entries: PayloadEntry[] }>();
      for (const entry of entries) {
        for (const part of this.splitEntryByAccount(channelType, entry)) {
          const channel = this.resolveProviderChannel(channelType, part.accountId);
          if (!channel) continue;
          const group = byChannel.get(channel.id) ?? { channel, entries: [] };
          group.entries.push(part.entry);
          byChannel.set(channel.id, group);
        }
      }
      for (const { channel, entries: channelEntries } of Array.from(byChannel.values())) {
        targets.push({ channel, payload: { ...parsedPayload, entry: channelEntries } });
      }
    }

    if (targets.length === 0) {
      logger.warn("social_webhook.unknown_channel", { channel_type: channelType });
      return { success: false, messagesProcessed: 0, receiptsProcessed: 0 };
    }

    // 2. Signature verification is mandatory for every target channel, with that channel's own credentials (or a
    //    platform-level secret such as META_APP_SECRET). The only exception is the public browser widget, which by
    //    design cannot hold a secret (restricted to active WEBSITE_CHAT channels and validated/capped by its route).
    const verified = targets.filter(({ channel }) => {
      if (options.unsignedWidget && channelType === "WEBSITE_CHAT") return true; // the widget route has its own limits
      let credentials: ChannelCredentials = {};
      try {
        credentials = ChannelService.getDecryptedCredentials(channel);
      } catch {
        // Unreadable per-channel credentials: the adapter can still use a platform-level secret or reject; it never
        // falls back to a built-in default.
        logger.warn("social_webhook.channel_credentials_unreadable", { tenant_id: channel.tenant_id, channel_id: channel.id });
      }
      const ok = adapter.verifyWebhook(rawBody, signature, headers, credentials);
      if (!ok) {
        logger.warn("social_webhook.signature_rejected", { tenant_id: channel.tenant_id, channel_id: channel.id });
        return false;
      }
      return withinChannelLimit(channel);
    });
    if (verified.length === 0) {
      throw new AuthenticationError("Webhook signature verification failed.");
    }

    let messagesProcessed = 0;
    let receiptsProcessed = 0;
    for (const { channel, payload } of verified) {
      const result = await this.processForChannel(adapter, channelType, channel, payload);
      messagesProcessed += result.messagesProcessed;
      receiptsProcessed += result.receiptsProcessed;
    }

    const single = verified.length === 1 ? verified[0].channel : undefined;
    return {
      success: true,
      messagesProcessed,
      receiptsProcessed,
      channelId: single?.id,
      tenantId: single?.tenant_id,
    };
  }

  /** Splits a Meta entry into parts that each belong to one provider account (Page id / WhatsApp phone number id). */
  private static splitEntryByAccount(channelType: ChannelType, entry: PayloadEntry): Array<{ accountId: string; entry: PayloadEntry }> {
    if (channelType === "WHATSAPP") {
      const changes = Array.isArray(entry?.changes) ? (entry.changes as Array<{ value?: Record<string, unknown> }>) : [];
      return changes.map((change) => {
        const meta = change?.value?.metadata as { phone_number_id?: string } | undefined;
        return { accountId: String(meta?.phone_number_id || ""), entry: { ...entry, changes: [change] } };
      });
    }
    return [{ accountId: String(entry?.id || ""), entry }];
  }

  /** The single ACTIVE channel registered for a provider account, or undefined when there is none or several. */
  private static resolveProviderChannel(channelType: ChannelType, accountId: string): ConnectedChannel | undefined {
    if (!accountId) return undefined;
    const matches = db.findConnectedChannelsByProviderId(channelType, accountId).filter((c) => c.status === "ACTIVE");
    if (matches.length > 1) {
      logger.error("social_webhook.ambiguous_channel", { channel_type: channelType, channel_ids: matches.map((c) => c.id) });
      return undefined;
    }
    return matches[0];
  }

  private static async processForChannel(
    adapter: IChannelProvider,
    channelType: ChannelType,
    channel: ConnectedChannel,
    payload: Record<string, unknown>
  ): Promise<{ messagesProcessed: number; receiptsProcessed: number }> {
    const tenantId = channel.tenant_id;
    const channelId = channel.id;

    // 3. Normalize Incoming Messages
    const normalizedMessages = adapter.normalizeIncomingEvent(payload, channelId);
    let messagesProcessed = 0;

    for (const norm of normalizedMessages) {
      // A. Identity Resolution (External user -> Canonical customer)
      const { customer } = await IdentityResolutionService.resolveCustomer(
        tenantId,
        channelId,
        channelType,
        norm.externalSenderId,
        norm.senderProfile
      );

      // B. Conversation lookup or creation
      const { conversation, isNew } = await ConversationService.findOrCreateConversation(
        tenantId,
        channelId,
        channelType,
        customer.id,
        norm.externalConversationId,
        {
          sourceCampaign: norm.sourceMetadata?.campaign,
          sourceAd: norm.sourceMetadata?.adId,
          sourcePost: norm.sourceMetadata?.postId,
          sourceStory: norm.sourceMetadata?.storyId,
          sourceUrl: norm.sourceMetadata?.pageUrl,
        }
      );

      // C. Process message & check idempotency
      const { message, isDuplicate } = await MessageService.processInboundMessage(tenantId, conversation.id, norm);

      if (!isDuplicate) {
        messagesProcessed++;

        // D. Deterministic Team Routing on first message or new intent
        const intent = (message.metadata?.detected_intent as string) || undefined;
        const targetTeam = AssignmentService.determineTeamRoute(intent);
        if (targetTeam && !conversation.assigned_team_id) {
          db.updateConversation(tenantId, conversation.id, {
            assigned_team_id: targetTeam,
          });
        }

        // E. Emit message.received event
        SocialEventService.emit({
          tenantId,
          eventType: "message.received",
          aggregateType: "conversation",
          aggregateId: conversation.id,
          actor: { type: "CUSTOMER", id: customer.id },
          payload: {
            conversationId: conversation.id,
            messageId: message.id,
            channelType,
            text: message.text,
            isNewConversation: isNew,
            detectedIntent: intent,
          },
        });
      }
    }

    // 4. Parse & Process Delivery Receipts
    const receipts = adapter.parseDeliveryReceipts(payload);
    let receiptsProcessed = 0;

    for (const receipt of receipts) {
      const msg = db.findMessageByExternalId(tenantId, channelId, receipt.externalMessageId);
      if (msg) {
        if (receipt.status === "DELIVERED") {
          db.updateMessage(tenantId, msg.id, {
            status: "DELIVERED",
            delivered_at: receipt.timestamp,
          });
          receiptsProcessed++;
        } else if (receipt.status === "READ") {
          db.updateMessage(tenantId, msg.id, {
            status: "READ",
            read_at: receipt.timestamp,
          });
          receiptsProcessed++;
        } else if (receipt.status === "FAILED") {
          db.updateMessage(tenantId, msg.id, {
            status: "FAILED",
            failed_at: receipt.timestamp,
            failure_reason: receipt.failureReason,
          });
          receiptsProcessed++;
        }
      }
    }

    // Update channel last webhook timestamp
    db.updateConnectedChannel(tenantId, channelId, {
      last_webhook_at: new Date().toISOString(),
    });

    return { messagesProcessed, receiptsProcessed };
  }
}
