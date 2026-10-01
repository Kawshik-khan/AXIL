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

/** The part of a Meta error message that is safe to show: short, with anything token-shaped removed. */
function safeError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200);
}

async function graphCall(credentials: ChannelCredentials, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = typeof credentials.accessToken === "string" ? credentials.accessToken : "";
  if (!token) throw new IntegrationNotConfiguredError("Instagram messaging", "no page access token");
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
      throw new AppError("INSTAGRAM_UNREACHABLE", "Instagram could not be reached. Nothing was sent.", 502);
    }
    throw err;
  }
  let parsed: { error?: { code?: number; message?: string }; message_id?: string } = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {
    // not JSON: handled below
  }
  if (res.status >= 200 && res.status < 300 && !parsed.error) return parsed;
  const code = parsed.error?.code ?? res.status;
  const msg = safeError(parsed.error?.message);
  if (code === 190) throw new IntegrationNotConfiguredError("Instagram messaging", "the Instagram access token has expired");
  if (code === 4 || code === 17 || code === 32) throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram rate limit hit. Retry later.", 429);
  if (code === 200) throw new AppError("INSTAGRAM_PERMISSION_DENIED", "The Instagram app lacks permission for this operation.", 403);
  if (code === 10) throw new AppError("INSTAGRAM_PERMISSION_DENIED", "The Instagram app lacks permission for this operation.", 403);
  throw new AppError("INSTAGRAM_API_ERROR", `Instagram refused the request: ${msg}`, res.status >= 400 && res.status < 500 ? 400 : 502);
}

export class InstagramAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "INSTAGRAM";

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
      const messaging = (entry.messaging as Array<Record<string, unknown>>) || [];
      for (const item of messaging) {
        if (!item.message) continue;

        const sender = item.sender as { id: string } | undefined;
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
          if (first === "IMAGE" || first === "SHARE") msgType = "IMAGE";
          else if (first === "VIDEO") msgType = "VIDEO";
          else if (first === "AUDIO") msgType = "AUDIO";
          else msgType = "UNKNOWN";
        }

        results.push({
          channelType: "INSTAGRAM",
          channelId,
          externalEventId: `ig_evt_${message.mid || Date.now()}`,
          externalMessageId: message.mid,
          externalConversationId: `ig_conv_${sender.id}`,
          externalSenderId: sender.id,
          senderProfile: {
            displayName: `@ig_user_${sender.id.slice(-4)}`,
            username: `ig_user_${sender.id.slice(-4)}`,
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
        if (item.read) {
          const read = item.read as { watermark?: number };
          receipts.push({
            externalMessageId: `ig_watermark_${read.watermark}`,
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
    const result = await graphCall(credentials, `/${recipientId}/messages`, {
      recipient: { id: recipientId },
      message: { text: text.slice(0, 1000) },
      messaging_type: "RESPONSE",
    });
    const msgId = typeof result.message_id === "string" ? result.message_id : "";
    if (!msgId) throw new AppError("INSTAGRAM_API_ERROR", "Instagram did not return a message id.", 502);
    return { externalMessageId: msgId, status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendMediaMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    if (!/^https:\/\//i.test(mediaUrl)) throw new AppError("INSTAGRAM_MEDIA_URL", "Instagram media must be an https URL.", 400);
    const typeMap = { IMAGE: "image", VIDEO: "video", AUDIO: "audio", FILE: "file" } as const;
    const igType = typeMap[mediaType];
    const attachment: Record<string, unknown> = { type: igType, payload: { url: mediaUrl } };
    if (options?.caption) attachment.payload = { ...(attachment.payload as object), caption: options.caption.slice(0, 1024) };
    const result = await graphCall(credentials, `/${recipientId}/messages`, {
      recipient: { id: recipientId },
      message: { attachment },
      messaging_type: "RESPONSE",
    });
    const msgId = typeof result.message_id === "string" ? result.message_id : "";
    if (!msgId) throw new AppError("INSTAGRAM_API_ERROR", "Instagram did not return a message id.", 502);
    return { externalMessageId: msgId, status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendTemplateMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<SendMessageResult> {
    const elements = Object.entries(parameters).map(([key, value]) => ({
      title: key,
      subtitle: String(value).slice(0, 80),
    }));
    const result = await graphCall(credentials, `/${recipientId}/messages`, {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: { template_type: "generic", elements },
        },
      },
      messaging_type: "RESPONSE",
    });
    const msgId = typeof result.message_id === "string" ? result.message_id : "";
    if (!msgId) throw new AppError("INSTAGRAM_API_ERROR", "Instagram did not return a message id.", 502);
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
      return { valid: false, error: "Access token is required for Instagram Direct Messages." };
    }
    return { valid: true, verified: false, error: "Live validation not implemented; credentials saved but not checked with Instagram." };
  }
}
