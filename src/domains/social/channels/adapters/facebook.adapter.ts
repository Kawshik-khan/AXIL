import { IntegrationNotConfiguredError } from "@/lib/errors";
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
    _credentials: ChannelCredentials,
    _recipientId: string,
    _text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Facebook Messenger messaging", "sending isn't implemented yet");
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    _mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Facebook Messenger messaging", "sending isn't implemented yet");
  }

  public async sendTemplateMessage(
    _credentials: ChannelCredentials,
    _recipientId: string,
    _templateName: string,
    _parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    // Used to return a made-up message id with status SENT (FX-31, non-negotiable 7)
    throw new IntegrationNotConfiguredError("Facebook Messenger messaging", "sending isn't implemented yet");
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

  public async validateCredentials(credentials: ChannelCredentials): Promise<{ valid: boolean; verified?: boolean; error?: string }> {
    if (!credentials.accessToken && !credentials.apiKey) {
      return { valid: false, error: "Access token or API key is required for Facebook Messenger." };
    }
    return { valid: true, verified: false, error: "Live validation not implemented; credentials saved but not checked with Facebook Messenger." };
  }
}
