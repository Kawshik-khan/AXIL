import { IntegrationNotConfiguredError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import crypto from "crypto";
import { ChannelType, NormalizedIncomingMessage } from "@/types/social";
import {
  IChannelProvider,
  ChannelCredentials,
  SendMessageResult,
  DeliveryReceipt,
  UserProfileResult,
} from "../channel-provider.interface";

export class WebsiteChatAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "WEBSITE_CHAT";

  public verifyWebhook(
    payload: string | Buffer,
    signature: string | null,
    _headers: Record<string, string | string[] | undefined>,
    credentials: ChannelCredentials
  ): boolean {
    // Server-to-server website ingress must be signed with the channel's webhook secret (audit H5).
    // The public browser widget does not come through here; it uses WebhookIngressService's unsigned-widget path.
    if (!credentials.webhookSecret || !signature) return false;
    const bodyStr = typeof payload === "string" ? payload : payload.toString("utf8");
    const hmac = crypto.createHmac("sha256", credentials.webhookSecret).update(bodyStr).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
    } catch {
      return false;
    }
  }

  public normalizeIncomingEvent(
    rawPayload: Record<string, unknown>,
    channelId: string
  ): NormalizedIncomingMessage[] {
    const anonymousId = String(rawPayload.anonymous_id || rawPayload.visitor_id || `anon_${Date.now()}_${randomSuffix()}`);
    const text = String(rawPayload.text || rawPayload.message || "");
    const messageId = String(rawPayload.client_message_id || `web_msg_${Date.now()}_${randomSuffix()}`);

    return [
      {
        channelType: "WEBSITE_CHAT",
        channelId,
        externalEventId: `web_evt_${messageId}`,
        externalMessageId: messageId,
        externalConversationId: `web_conv_${anonymousId}`,
        externalSenderId: anonymousId,
        senderProfile: {
          displayName: rawPayload.customer_name ? String(rawPayload.customer_name) : `Website Visitor (${anonymousId.slice(-4)})`,
          email: rawPayload.email ? String(rawPayload.email) : undefined,
          phone: rawPayload.phone ? String(rawPayload.phone) : undefined,
        },
        direction: "INBOUND",
        messageType: "TEXT",
        text,
        sourceMetadata: {
          pageUrl: rawPayload.page_url ? String(rawPayload.page_url) : undefined,
          referrer: rawPayload.referrer ? String(rawPayload.referrer) : undefined,
        },
        timestamp: new Date().toISOString(),
        rawPayload,
      },
    ];
  }

  public parseDeliveryReceipts(_rawPayload: Record<string, unknown>): DeliveryReceipt[] {
    return [];
  }

  public async sendTextMessage(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Website chat messaging", "the widget has no way to receive replies yet");
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    _mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Website chat messaging", "the widget has no way to receive replies yet");
  }

  public async sendTemplateMessage(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _templateName: string,
    _parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Website chat messaging", "the widget has no way to receive replies yet");
  }

  public async markMessageRead(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _messageId?: string
  ): Promise<boolean> {
    return false; // not sent to the provider (FX-31)
  }

  public async getUserProfile(
    _credentials: ChannelCredentials,
    externalUserId: string
  ): Promise<UserProfileResult | null> {
    return null; // profiles aren't fetched from the provider yet; no invented names (FX-31)
  }

  public async validateCredentials(_credentials: ChannelCredentials): Promise<{ valid: boolean; verified?: boolean; error?: string }> {
    return { valid: true, verified: false, error: "Live validation not implemented; credentials saved but not checked with Website chat." };
  }
}
