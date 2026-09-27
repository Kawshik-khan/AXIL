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

export class WhatsAppAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "WHATSAPP";

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
      const changes = (entry.changes as Array<{ value?: Record<string, unknown> }>) || [];
      for (const change of changes) {
        const val = change.value;
        if (!val) continue;

        const messages = (val.messages as Array<Record<string, unknown>>) || [];
        const contacts = (val.contacts as Array<{ profile?: { name?: string }; wa_id?: string }>) || [];
        const contactMap = new Map<string, string>();
        for (const c of contacts) {
          if (c.wa_id && c.profile?.name) {
            contactMap.set(c.wa_id, c.profile.name);
          }
        }

        for (const msg of messages) {
          const from = String(msg.from || "");
          const msgId = String(msg.id || "");
          const timestamp = String(msg.timestamp || "");
          const type = String(msg.type || "text");

          let text = "";
          const attachments: NormalizedIncomingMessage["attachments"] = [];
          let messageType: NormalizedIncomingMessage["messageType"] = "TEXT";

          if (type === "text" && msg.text) {
            text = String((msg.text as { body?: string }).body || "");
            messageType = "TEXT";
          } else if (type === "image" && msg.image) {
            const img = msg.image as { id?: string; mime_type?: string; caption?: string };
            text = img.caption || "";
            messageType = "IMAGE";
            attachments.push({
              type: "IMAGE",
              url: `https://graph.facebook.com/v21.0/${img.id}`,
              mimeType: img.mime_type,
            });
          } else if (type === "video" && msg.video) {
            const vid = msg.video as { id?: string; mime_type?: string; caption?: string };
            text = vid.caption || "";
            messageType = "VIDEO";
            attachments.push({
              type: "VIDEO",
              url: `https://graph.facebook.com/v21.0/${vid.id}`,
              mimeType: vid.mime_type,
            });
          } else if (type === "audio" && msg.audio) {
            const aud = msg.audio as { id?: string; mime_type?: string };
            messageType = "AUDIO";
            attachments.push({
              type: "AUDIO",
              url: `https://graph.facebook.com/v21.0/${aud.id}`,
              mimeType: aud.mime_type,
            });
          } else if (type === "document" && msg.document) {
            const doc = msg.document as { id?: string; filename?: string; mime_type?: string; caption?: string };
            text = doc.caption || "";
            messageType = "FILE";
            attachments.push({
              type: "FILE",
              url: `https://graph.facebook.com/v21.0/${doc.id}`,
              fileName: doc.filename,
              mimeType: doc.mime_type,
            });
          } else if (type === "interactive") {
            const inter = msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } };
            text = inter.button_reply?.title || inter.list_reply?.title || "Interactive Selection";
            messageType = "TEXT";
          }

          // Format phone number
          const phoneFormatted = from.startsWith("+") ? from : `+${from}`;
          const contactName = contactMap.get(from) || `WhatsApp (${from.slice(-4)})`;

          results.push({
            channelType: "WHATSAPP",
            channelId,
            externalEventId: `wa_evt_${msgId}`,
            externalMessageId: msgId,
            externalConversationId: `wa_conv_${from}`,
            externalSenderId: from,
            senderProfile: {
              displayName: contactName,
              phone: phoneFormatted,
            },
            direction: "INBOUND",
            messageType,
            text,
            attachments,
            timestamp: timestamp
              ? new Date(Number(timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            rawPayload: msg,
          });
        }
      }
    }

    return results;
  }

  public parseDeliveryReceipts(rawPayload: Record<string, unknown>): DeliveryReceipt[] {
    const receipts: DeliveryReceipt[] = [];
    const entries = (rawPayload.entry as Array<Record<string, unknown>>) || [];

    for (const entry of entries) {
      const changes = (entry.changes as Array<{ value?: Record<string, unknown> }>) || [];
      for (const change of changes) {
        const statuses = (change.value?.statuses as Array<Record<string, unknown>>) || [];
        for (const st of statuses) {
          const rawStatus = String(st.status || "").toLowerCase();
          let internalStatus: DeliveryReceipt["status"] = "DELIVERED";
          if (rawStatus === "read") internalStatus = "READ";
          else if (rawStatus === "failed") internalStatus = "FAILED";

          receipts.push({
            externalMessageId: String(st.id || ""),
            recipientId: String(st.recipient_id || ""),
            status: internalStatus,
            timestamp: st.timestamp
              ? new Date(Number(st.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            failureReason: st.errors ? JSON.stringify(st.errors) : undefined,
          });
        }
      }
    }

    return receipts;
  }

  public async sendTextMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    const mockId = `wamid.HB_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { messages: [{ id: mockId }], recipient: recipientId, text },
    };
  }

  public async sendMediaMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    _options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const mockId = `wamid.HB_media_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { messages: [{ id: mockId }], recipient: recipientId, media_type: mediaType, url: mediaUrl },
    };
  }

  public async sendTemplateMessage(
    _credentials: ChannelCredentials,
    recipientId: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    const mockId = `wamid.HB_tpl_${Date.now()}_${randomSuffix()}`;
    return {
      externalMessageId: mockId,
      status: "SENT",
      providerTimestamp: new Date().toISOString(),
      rawResponse: { messages: [{ id: mockId }], recipient: recipientId, template: templateName, parameters },
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
      displayName: `WhatsApp User (+${externalUserId})`,
      phone: externalUserId.startsWith("+") ? externalUserId : `+${externalUserId}`,
    };
  }

  public async validateCredentials(credentials: ChannelCredentials): Promise<{ valid: boolean; error?: string }> {
    if (!credentials.accessToken && !credentials.apiKey) {
      return { valid: false, error: "System user access token is required for WhatsApp Business Cloud API." };
    }
    if (!credentials.phoneNumberId) {
      return { valid: false, error: "Phone Number ID is required for WhatsApp Business." };
    }
    return { valid: true };
  }
}
