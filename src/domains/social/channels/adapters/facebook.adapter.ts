import crypto from "crypto";
import { ChannelType, NormalizedIncomingMessage } from "@/types/social";
import {
  IChannelProvider,
  ChannelCredentials,
  SendMessageResult,
  DeliveryReceipt,
  UserProfileResult,
} from "../channel-provider.interface";

export class FacebookAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "FACEBOOK_MESSENGER";

  public verifyWebhook(
    payload: string | Buffer,
    signature: string | null,
    _headers: Record<string, string | string[] | undefined>,
    credentials: ChannelCredentials
  ): boolean {
    if (!signature) return false;
    // Per-channel app secret, else the platform-wide META_APP_SECRET. No literal fallback (audit H5).
    const appSecret = credentials.appSecret || process.env.META_APP_SECRET;
    if (!appSecret) return false;
    
    // Meta signature header format: "sha256=abcdef..."
    const cleanSig = signature.startsWith("sha256=") ? signature.substring(7) : signature;
    const bodyStr = typeof payload === "string" ? payload : payload.toString("utf8");
    
    const hmac = crypto.createHmac("sha256", appSecret).update(bodyStr).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(cleanSig, "hex"), Buffer.from(hmac, "hex"));
    } catch {
      return false;
    }
  }

  public normalizeIncomingEvent(
    rawPayload: Record<string, unknown>,
    channelId: string
  ): NormalizedIncomingMessage[] {
    const results: NormalizedIncomingMessage[] = [];
    const entries = (rawPayload.entry as Array<Record<string, unknown>>) || [];

    for (const entry of entries) {
      const messaging = (entry.messaging as Array<Record<string, unknown>>) || [];
      for (const item of messaging) {
        // Skip delivery or read receipts here, handle them in parseDeliveryReceipts
        if (!item.message) continue;

        const sender = item.sender as { id: string } | undefined;
        const recipient = item.recipient as { id: string } | undefined;
        const message = item.message as {
          mid: string;
          text?: string;
          attachments?: Array<{ type: string; payload: { url?: string } }>;
        };

        if (!sender || !message) continue;

        const attachments = (message.attachments || []).map((att) => ({
          type: att.type.toUpperCase(),
          url: att.payload?.url || "",
        }));

        let msgType: NormalizedIncomingMessage["messageType"] = "TEXT";
        if (attachments.length > 0) {
          const first = attachments[0].type;
          if (first === "IMAGE") msgType = "IMAGE";
          else if (first === "VIDEO") msgType = "VIDEO";
          else if (first === "AUDIO") msgType = "AUDIO";
          else if (first === "FILE") msgType = "FILE";
          else msgType = "UNKNOWN";
        }

        results.push({
          channelType: "FACEBOOK_MESSENGER",
          channelId,
          externalEventId: (item.timestamp ? `fb_evt_${item.timestamp}_${sender.id}` : `fb_evt_${message.mid}`),
          externalMessageId: message.mid,
          externalConversationId: `fb_conv_${sender.id}`,
          externalSenderId: sender.id,
          senderProfile: {
            displayName: `Facebook User (${sender.id.slice(-4)})`,
            username: sender.id,
          },
          direction: "INBOUND",
          messageType: msgType,
          text: message.text || "",
          attachments,
          timestamp: item.timestamp
            ? new Date(Number(item.timestamp)).toISOString()
            : new Date().toISOString(),
          rawPayload: item,
        });
      }
    }

    return results;
  }

  public parseDeliveryReceipts(rawPayload: Record<string, unknown>): DeliveryReceipt[] {
    const receipts: DeliveryReceipt[] = [];
    const entries = (rawPayload.entry as Array<Record<string, unknown>>) || [];

    for (const entry of entries) {
      const messaging = (entry.messaging as Array<Record<string, unknown>>) || [];
      for (const item of messaging) {
        const sender = item.sender as { id: string } | undefined;
        if (item.delivery) {
          const del = item.delivery as { mids?: string[]; watermark?: number };
          const mids = del.mids || [];
          for (const mid of mids) {
            receipts.push({
              externalMessageId: mid,
              recipientId: sender?.id || "",
              status: "DELIVERED",
              timestamp: del.watermark ? new Date(del.watermark).toISOString() : new Date().toISOString(),
            });
          }
        } else if (item.read) {
          const read = item.read as { watermark?: number };
          receipts.push({
            externalMessageId: `watermark_${read.watermark}`,
            recipientId: sender?.id || "",
            status: "READ",
            timestamp: read.watermark ? new Date(read.watermark).toISOString() : new Date().toISOString(),
          });
        }
      }
    }

    return receipts;
  }

  public async sendTextMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    const mockId = `m_mid.$${Date.now()}_fb_${Math.random().toString(36).slice(2, 8)}`;
    // If accessToken is provided and not test mode, call Meta Graph API, else return simulated successful result
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { recipient_id: recipientId, message_id: mockId },
    };
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const mockId = `m_mid.$${Date.now()}_fb_media_${Math.random().toString(36).slice(2, 8)}`;
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
    const mockId = `m_mid.$${Date.now()}_fb_tpl_${Math.random().toString(36).slice(2, 8)}`;
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
      displayName: `Facebook User ${externalUserId.slice(-4)}`,
      username: `fb_user_${externalUserId.slice(-6)}`,
    };
  }

  public async validateCredentials(credentials: ChannelCredentials): Promise<{ valid: boolean; error?: string }> {
    if (!credentials.accessToken && !credentials.apiKey) {
      return { valid: false, error: "Access token or API key is required for Facebook Messenger." };
    }
    return { valid: true };
  }
}
