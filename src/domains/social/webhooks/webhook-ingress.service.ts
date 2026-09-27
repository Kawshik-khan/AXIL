import { db } from "@/infrastructure/db";
import { ChannelType, ConnectedChannel } from "@/types/social";
import { ChannelService } from "../channels/channel.service";
import { ChannelCredentials } from "../channels/channel-provider.interface";
import { logger } from "@/lib/logger";
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

    // 1. Resolve the channel strictly (audit H5): by its public id, or by the provider account id in the
    //    payload. There is no "first active channel" or sandbox-tenant fallback — an unknown channel is ignored.
    let channel: ConnectedChannel | undefined;
    if (channelIdOverride) {
      channel = db.findConnectedChannelForIngress(channelIdOverride);
    } else {
      let providerAccountId = "";
      if (channelType === "FACEBOOK_MESSENGER" || channelType === "INSTAGRAM") {
        const entry = (parsedPayload.entry as Array<Record<string, unknown>>)?.[0];
        providerAccountId = String(entry?.id || "");
      } else if (channelType === "WHATSAPP") {
        const entry = (parsedPayload.entry as Array<Record<string, unknown>>)?.[0];
        const changes = (entry?.changes as Array<{ value?: Record<string, unknown> }>)?.[0];
        const meta = changes?.value?.metadata as { phone_number_id?: string } | undefined;
        providerAccountId = String(meta?.phone_number_id || "");
      }
      if (providerAccountId) {
        channel = db.findConnectedChannelByProviderId(channelType, providerAccountId);
      }
    }

    if (!channel || channel.type !== channelType || channel.status !== "ACTIVE") {
      logger.warn("social_webhook.unknown_channel", { channel_type: channelType });
      return { success: false, messagesProcessed: 0, receiptsProcessed: 0 };
    }

    const tenantId = channel.tenant_id;
    const channelId = channel.id;

    // 2. Signature verification is mandatory, except for the public browser widget, which by design cannot hold
    //    a secret (it is restricted to active WEBSITE_CHAT channels and validated/capped by its route).
    if (!(options.unsignedWidget && channelType === "WEBSITE_CHAT")) {
      let credentials: ChannelCredentials = {};
      try {
        credentials = ChannelService.getDecryptedCredentials(channel);
      } catch {
        // Unreadable per-channel credentials: the adapter can still use a platform-level secret (e.g. META_APP_SECRET)
        // or reject; it never falls back to a built-in default.
        logger.warn("social_webhook.channel_credentials_unreadable", { tenant_id: tenantId, channel_id: channelId });
      }
      if (!adapter.verifyWebhook(rawBody, signature, headers, credentials)) {
        throw new AuthenticationError("Webhook signature verification failed.");
      }
    }

    // 3. Normalize Incoming Messages
    const normalizedMessages = adapter.normalizeIncomingEvent(parsedPayload, channelId!);
    let messagesProcessed = 0;

    for (const norm of normalizedMessages) {
      // A. Identity Resolution (External user -> Canonical customer)
      const { customer } = await IdentityResolutionService.resolveCustomer(
        tenantId!,
        channelId!,
        channelType,
        norm.externalSenderId,
        norm.senderProfile
      );

      // B. Conversation lookup or creation
      const { conversation, isNew } = await ConversationService.findOrCreateConversation(
        tenantId!,
        channelId!,
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
      const { message, isDuplicate } = await MessageService.processInboundMessage(
        tenantId!,
        conversation.id,
        norm
      );

      if (!isDuplicate) {
        messagesProcessed++;

        // D. Deterministic Team Routing on first message or new intent
        const intent = (message.metadata?.detected_intent as string) || undefined;
        const targetTeam = AssignmentService.determineTeamRoute(intent);
        if (targetTeam && !conversation.assigned_team_id) {
          db.updateConversation(tenantId!, conversation.id, {
            assigned_team_id: targetTeam,
          });
        }

        // E. Emit message.received event
        SocialEventService.emit({
          tenantId: tenantId!,
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
    const receipts = adapter.parseDeliveryReceipts(parsedPayload);
    let receiptsProcessed = 0;

    for (const receipt of receipts) {
      const msg = db.findMessageByExternalId(tenantId!, channelId!, receipt.externalMessageId);
      if (msg) {
        if (receipt.status === "DELIVERED") {
          db.updateMessage(tenantId!, msg.id, {
            status: "DELIVERED",
            delivered_at: receipt.timestamp,
          });
          receiptsProcessed++;
        } else if (receipt.status === "READ") {
          db.updateMessage(tenantId!, msg.id, {
            status: "READ",
            read_at: receipt.timestamp,
          });
          receiptsProcessed++;
        } else if (receipt.status === "FAILED") {
          db.updateMessage(tenantId!, msg.id, {
            status: "FAILED",
            failed_at: receipt.timestamp,
            failure_reason: receipt.failureReason,
          });
          receiptsProcessed++;
        }
      }
    }

    // Update channel last webhook timestamp
    if (channel) {
      db.updateConnectedChannel(tenantId!, channel.id, {
        last_webhook_at: new Date().toISOString(),
      });
    }

    return {
      success: true,
      messagesProcessed,
      receiptsProcessed,
      channelId,
      tenantId,
    };
  }
}
