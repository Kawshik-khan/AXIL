import { IntegrationNotConfiguredError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import crypto from "crypto";
import { ChannelType, NormalizedIncomingMessage, ProductCard } from "@/types/social";
import {
  IChannelProvider,
  ChannelCredentials,
  SendMessageResult,
  DeliveryReceipt,
  UserProfileResult,
} from "../channel-provider.interface";

/** Unix-seconds timestamp header that server-to-server website requests sign together with the body. */
export const WEBSITE_TIMESTAMP_HEADER = "x-commerceos-timestamp";
const WEBSITE_MAX_SKEW_SECONDS = 300;

export class WebsiteChatAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "WEBSITE_CHAT";

  public verifyWebhook(
    payload: string | Buffer,
    signature: string | null,
    headers: Record<string, string | string[] | undefined>,
    credentials: ChannelCredentials,
    now = Date.now()
  ): boolean {
    // Server-to-server website ingress must be signed with the channel's webhook secret (audit H5).
    // The public browser widget does not come through here; it uses WebhookIngressService's unsigned-widget path.
    if (!credentials.webhookSecret || !signature) return false;
    // The signature covers "<timestamp>.<raw body>" and the timestamp must be within 300 s, so a captured request
    // can't be replayed later (it used to cover the body alone).
    const rawTs = headers[WEBSITE_TIMESTAMP_HEADER];
    const ts = Array.isArray(rawTs) ? rawTs[0] : rawTs;
    if (!ts || !/^\d{10}$/.test(ts)) return false; // unix seconds
    if (Math.abs(now / 1000 - Number(ts)) > WEBSITE_MAX_SKEW_SECONDS) return false;
    const bodyStr = typeof payload === "string" ? payload : payload.toString("utf8");
    const expected = Buffer.from(crypto.createHmac("sha256", credentials.webhookSecret).update(`${ts}.${bodyStr}`).digest("hex"));
    const given = Buffer.from(signature.trim().toLowerCase());
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
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
    recipientId: string,
    _text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    const externalMessageId = `web_out_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId,
      status: "DELIVERED",
      providerTimestamp: new Date().toISOString(),
    };
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    _mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    _mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const externalMessageId = `web_out_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId,
      status: "DELIVERED",
      providerTimestamp: new Date().toISOString(),
    };
  }

  /** The widget reads the cards from the stored message (metadata.product_cards); nothing leaves the server. */
  public async sendProductCards(_credentials: ChannelCredentials, _recipientId: string, _cards: ProductCard[]): Promise<SendMessageResult> {
    return { externalMessageId: `web_out_${Date.now()}_${randomSuffix()}`, status: "DELIVERED", providerTimestamp: new Date().toISOString() };
  }

  public async sendTemplateMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    _templateName: string,
    _parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    const externalMessageId = `web_out_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId,
      status: "DELIVERED",
      providerTimestamp: new Date().toISOString(),
    };
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
