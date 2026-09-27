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
    // If webhook secret is configured, verify HMAC signature; otherwise allow authorized internal widget ingress
    if (credentials.webhookSecret && signature) {
      const bodyStr = typeof payload === "string" ? payload : payload.toString("utf8");
      const hmac = crypto.createHmac("sha256", credentials.webhookSecret).update(bodyStr).digest("hex");
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
      } catch {
        return false;
      }
    }
    return true;
  }

  public normalizeIncomingEvent(
    rawPayload: Record<string, unknown>,
    channelId: string
  ): NormalizedIncomingMessage[] {
    const anonymousId = String(rawPayload.anonymous_id || rawPayload.visitor_id || `anon_${Date.now()}`);
    const text = String(rawPayload.text || rawPayload.message || "");
    const messageId = String(rawPayload.client_message_id || `web_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

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
    recipientId: string,
    text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    const mockId = `web_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { recipient_id: recipientId, message_id: mockId, text },
    };
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const mockId = `web_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { recipient_id: recipientId, message_id: mockId, media_type: mediaType, url: mediaUrl },
    };
  }

  public async sendTemplateMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    const mockId = `web_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { recipient_id: recipientId, template: templateName, parameters },
    };
  }

  public async markMessageRead(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _messageId?: string
  ): Promise<boolean> {
    return true;
  }

  public async getUserProfile(
    _credentials: ChannelCredentials,
    externalUserId: string
  ): Promise<UserProfileResult | null> {
    return {
      displayName: `Website Visitor (${externalUserId.slice(-4)})`,
    };
  }

  public async validateCredentials(_credentials: ChannelCredentials): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }
}
