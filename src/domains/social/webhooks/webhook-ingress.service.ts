import { db } from "@/infrastructure/db";
import { ChannelType } from "@/types/social";
import { ChannelService } from "../channels/channel.service";
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
    channelIdOverride?: string
  ): Promise<WebhookIngressResult> {
    const adapter = ChannelService.getAdapter(channelType);

    // 1. Identify Channel
    let channel;
    const parsedPayload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    if (channelIdOverride) {
      // Direct lookup by ID
      const allChannels = db.getConnectedChannels(""); // Search across tenants safely
      channel = db.findConnectedChannelById(channelIdOverride.split("_")[0] || "", channelIdOverride);
    }

    if (!channel) {
      // Match provider account ID (e.g. Page ID or Phone Number ID) from payload
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

    // Fallback for test/sandboxes if channel not yet registered
    let tenantId = channel?.tenant_id;
    let channelId = channel?.id;

    if (!channel) {
      // Check if any active channel of this type exists
      const allActive = (db as any).data.connected_channels.filter(
        (c: any) => c.type === channelType && c.status === "ACTIVE"
      );
      if (allActive.length > 0) {
        channel = allActive[0];
        tenantId = channel.tenant_id;
        channelId = channel.id;
      } else {
        // Mock channel for sandbox verification
        tenantId = "ten_default_dhaka";
        channelId = `chn_${channelType.toLowerCase().slice(0, 3)}_default`;
      }
    }

    // 2. Cryptographic Signature Verification
    if (channel) {
      const credentials = ChannelService.getDecryptedCredentials(channel);
      const isValid = adapter.verifyWebhook(rawBody, signature, headers, credentials);
      if (!isValid) {
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
