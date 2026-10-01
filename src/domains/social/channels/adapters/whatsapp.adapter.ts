import { IntegrationNotConfiguredError, AppError } from "@/lib/errors";
import crypto from "crypto";
import { outboundRequest, OutboundBlockedError, OutboundTimeoutError, OutboundNetworkError } from "@/lib/outbound-http";
import { ChannelType, NormalizedIncomingMessage } from "@/types/social";
import {
  IChannelProvider,
  ChannelCredentials,
  SendMessageResult,
  DeliveryReceipt,
  UserProfileResult,
} from "../channel-provider.interface";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const CALL_TIMEOUT_MS = 10_000;

/** The part of a WhatsApp error message that is safe to show: short, with anything token-shaped removed. */
function safeError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200);
}

async function graphCall(credentials: ChannelCredentials, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = typeof credentials.accessToken === "string" ? credentials.accessToken : "";
  if (!token) throw new IntegrationNotConfiguredError("WhatsApp messaging", "no access token");
  let res;
  try {
    res = await outboundRequest(`${GRAPH_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      timeoutMs: CALL_TIMEOUT_MS,
      maxResponseBytes: 256 * 1024,
    });
  } catch (err) {
    if (err instanceof OutboundBlockedError || err instanceof OutboundTimeoutError || err instanceof OutboundNetworkError) {
      throw new AppError("WHATSAPP_UNREACHABLE", "WhatsApp could not be reached. Nothing was sent.", 502);
    }
    throw err;
  }
  let parsed: { error?: { code?: number; message?: string }; messages?: Array<{ id?: string }> } = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {
    // not JSON: handled below
  }
  if (res.status >= 200 && res.status < 300 && !parsed.error) return parsed;
  const code = parsed.error?.code ?? res.status;
  const msg = safeError(parsed.error?.message);
  // Map common WhatsApp error codes
  if (code === 131047) throw new AppError("WHATSAPP_RE_ENGAGEMENT_REQUIRED", "The customer hasn't messaged in the last 24 hours. A template message is required.", 400);
  if (code === 131026) throw new AppError("WHATSAPP_UNDELIVERABLE", "The message could not be delivered to this phone number.", 400);
  if (code === 4 || code === 17 || code === 32 || code === 131047) throw new AppError("WHATSAPP_RATE_LIMITED", "WhatsApp rate limit hit. Retry later.", 429);
  if (code === 190) throw new IntegrationNotConfiguredError("WhatsApp messaging", "the WhatsApp access token has expired");
  if (code === 10) throw new AppError("WHATSAPP_PERMISSION_DENIED", "The WhatsApp app lacks permission for this operation.", 403);
  throw new AppError("WHATSAPP_API_ERROR", `WhatsApp refused the request: ${msg}`, res.status >= 400 && res.status < 500 ? 400 : 502);
}

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
    credentials: ChannelCredentials,
    recipientId: string,
    text: string,
    _options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult> {
    const phoneNumberId = typeof credentials.phoneNumberId === "string" ? credentials.phoneNumberId : "";
    if (!phoneNumberId) throw new IntegrationNotConfiguredError("WhatsApp messaging", "phone number id is required");
    const result = await graphCall(credentials, `/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: recipientId,
      type: "text",
      text: { body: text.slice(0, 4096) },
    });
    const msgId = (result.messages as Array<{ id?: string }>)?.[0]?.id;
    if (!msgId) throw new AppError("WHATSAPP_API_ERROR", "WhatsApp did not return a message id.", 502);
    return { externalMessageId: msgId, status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendMediaMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const phoneNumberId = typeof credentials.phoneNumberId === "string" ? credentials.phoneNumberId : "";
    if (!phoneNumberId) throw new IntegrationNotConfiguredError("WhatsApp messaging", "phone number id is required");
    if (!/^https:\/\//i.test(mediaUrl)) throw new AppError("WHATSAPP_MEDIA_URL", "WhatsApp media must be an https URL.", 400);
    const typeMap = { IMAGE: "image", VIDEO: "video", AUDIO: "audio", FILE: "document" } as const;
    const waType = typeMap[mediaType];
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: recipientId,
      type: waType,
      [waType]: { link: mediaUrl },
    };
    if (options?.caption) body[waType] = { ...(body[waType] as object), caption: options.caption.slice(0, 1024) };
    if (options?.fileName && mediaType === "FILE") body[waType] = { ...(body[waType] as object), filename: options.fileName.slice(0, 255) };
    const result = await graphCall(credentials, `/${phoneNumberId}/messages`, body);
    const msgId = (result.messages as Array<{ id?: string }>)?.[0]?.id;
    if (!msgId) throw new AppError("WHATSAPP_API_ERROR", "WhatsApp did not return a message id.", 502);
    return { externalMessageId: msgId, status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendTemplateMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    const phoneNumberId = typeof credentials.phoneNumberId === "string" ? credentials.phoneNumberId : "";
    if (!phoneNumberId) throw new IntegrationNotConfiguredError("WhatsApp messaging", "phone number id is required");
    const components = Object.entries(parameters).map(([key, value]) => ({
      type: "body",
      parameters: [{ type: "text", text: String(value).slice(0) }],
    }));
    const result = await graphCall(credentials, `/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: recipientId,
      type: "template",
      template: { name: templateName, language: { code: "en_US" }, ...(components.length > 0 ? { components } : {}) },
    });
    const msgId = (result.messages as Array<{ id?: string }>)?.[0]?.id;
    if (!msgId) throw new AppError("WHATSAPP_API_ERROR", "WhatsApp did not return a message id.", 502);
    return { externalMessageId: msgId, status: "SENT", providerTimestamp: new Date().toISOString() };
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
      return { valid: false, error: "System user access token is required for WhatsApp Business Cloud API." };
    }
    if (!credentials.phoneNumberId) {
      return { valid: false, error: "Phone Number ID is required for WhatsApp Business." };
    }
    return { valid: true, verified: false, error: "Live validation not implemented; credentials saved but not checked with WhatsApp." };
  }
}
