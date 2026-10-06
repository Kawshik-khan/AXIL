import crypto from "crypto";
import { BadRequestError, AppError } from "@/lib/errors";
import { outboundRequest, OutboundBlockedError, OutboundNetworkError, OutboundTimeoutError } from "@/lib/outbound-http";
import { ChannelType, NormalizedIncomingMessage } from "@/types/social";
import {
  IChannelProvider,
  ChannelCredentials,
  SendMessageResult,
  DeliveryReceipt,
  UserProfileResult,
} from "../channel-provider.interface";

/**
 * Telegram Bot API adapter (connector plan C3). Telegram has one webhook URL per bot, so inbound events arrive at
 * /api/v1/connectors/<connector id>/webhook and are authenticated with the secret_token that was registered with
 * setWebhook (header X-Telegram-Bot-Api-Secret-Token). Every call goes through the SSRF-guarded client; the bot token
 * is in the request path, so it is never logged and never put in an error message.
 */

const TELEGRAM_API = "https://api.telegram.org";
const CALL_TIMEOUT_MS = 8_000;
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";
const TOKEN_PATTERN = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;

export class TelegramApiError extends AppError {
  constructor(public readonly telegramCode: number, description: string, public readonly retryAfterSeconds?: number) {
    super("TELEGRAM_API_ERROR", `Telegram refused the request (${telegramCode}): ${description}`, telegramCode === 429 ? 429 : 502);
  }
}

function botToken(credentials: ChannelCredentials): string {
  const token = typeof credentials.bot_token === "string" ? credentials.bot_token.trim() : "";
  if (!TOKEN_PATTERN.test(token)) throw new BadRequestError("The Telegram bot token is missing or malformed.");
  return token;
}

/** The part of a Telegram description that is safe to show: short, with anything token-shaped removed. */
function safeDescription(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/\d{3,20}:[A-Za-z0-9_-]{20,100}/g, "[token]").slice(0, 160);
}

export async function telegramCall(credentials: ChannelCredentials, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = botToken(credentials);
  let res;
  try {
    res = await outboundRequest(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(params),
      timeoutMs: CALL_TIMEOUT_MS,
      maxResponseBytes: 256 * 1024,
    });
  } catch (err) {
    if (err instanceof OutboundBlockedError || err instanceof OutboundTimeoutError || err instanceof OutboundNetworkError) {
      throw new AppError("TELEGRAM_UNREACHABLE", "Telegram could not be reached. Nothing was sent.", 502);
    }
    throw err;
  }
  let body: { ok?: boolean; result?: Record<string, unknown>; description?: string; error_code?: number; parameters?: { retry_after?: number } } = {};
  try {
    body = JSON.parse(res.body);
  } catch {
    // not JSON: handled below as a failure
  }
  if (res.status === 200 && body.ok === true) return (body.result ?? {}) as Record<string, unknown>;
  throw new TelegramApiError(body.error_code ?? res.status, safeDescription(body.description), body.parameters?.retry_after);
}

export class TelegramAdapter implements IChannelProvider {
  public readonly channelType: ChannelType = "TELEGRAM";

  public verifyWebhook(
    _payload: string | Buffer,
    _signature: string | null,
    headers: Record<string, string | string[] | undefined>,
    credentials: ChannelCredentials
  ): boolean {
    const expected = typeof credentials.webhook_secret === "string" ? credentials.webhook_secret : "";
    const raw = headers[TELEGRAM_SECRET_HEADER];
    const given = Array.isArray(raw) ? raw[0] : raw;
    if (!expected || !given) return false;
    const a = crypto.createHash("sha256").update(expected).digest();
    const b = crypto.createHash("sha256").update(given).digest();
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Update -> message, for the direct (no n8n) path and for tests. With n8n in the path the same mapping is done by the
   * "normalize" workflow; tests/social-n8n-tests.ts runs both on the same samples.
   */
  public normalizeIncomingEvent(rawPayload: Record<string, unknown>, channelId: string): NormalizedIncomingMessage[] {
    const updateId = rawPayload.update_id;
    const msg = rawPayload.message as
      | {
          message_id?: number; date?: number; text?: string; chat?: { id?: number | string; type?: string };
          from?: { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
          contact?: { phone_number?: string; user_id?: number };
        }
      | undefined;
    // FX-87: a shared contact. Only the sender's OWN contact (Telegram sets user_id to the account the number belongs to)
    // proves the number; someone else's contact card is just a message.
    const contact = msg?.contact;
    const ownContact = Boolean(contact && typeof contact.phone_number === "string" && contact.user_id !== undefined && contact.user_id === msg?.from?.id);
    const text = typeof msg?.text === "string" ? msg.text : contact ? (ownContact ? "[Shared their own phone number]" : "[Shared a contact]") : undefined;
    if (
      !Number.isSafeInteger(updateId) ||
      !msg ||
      !msg.from ||
      !Number.isSafeInteger(msg.from.id) ||
      msg.from.is_bot ||
      !msg.chat ||
      msg.chat.type !== "private" ||
      !(typeof msg.chat.id === "string" || Number.isSafeInteger(msg.chat.id)) ||
      !Number.isSafeInteger(msg.message_id) ||
      typeof text !== "string"
    ) return [];
    const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || undefined;
    return [
      {
        channelType: "TELEGRAM",
        channelId,
        externalEventId: String(updateId),
        // Telegram message_id is only unique within one chat. Include update_id and chat.id so retries are
        // idempotent and two customers with the same per-chat message_id do not collide.
        externalMessageId: `${updateId}:${msg.chat.id}:${msg.message_id}`,
        externalConversationId: String(msg.chat.id),
        externalSenderId: String(msg.from.id),
        senderProfile: { displayName: name, username: msg.from.username },
        direction: "INBOUND",
        messageType: "TEXT",
        text: text.slice(0, 4096),
        ...(ownContact ? { verifiedPhone: String(contact!.phone_number).replace(/[^\d+]/g, "").slice(0, 20) } : {}),
        timestamp: new Date((Number.isSafeInteger(msg.date) ? msg.date! : Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        rawPayload,
      },
    ];
  }

  public parseDeliveryReceipts(_rawPayload: Record<string, unknown>): DeliveryReceipt[] {
    return []; // Telegram sends no delivery or read receipts for bots
  }

  public async sendTextMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<SendMessageResult> {
    const result = await telegramCall(credentials, "sendMessage", {
      chat_id: recipientId,
      text,
      ...(options?.replyToMessageId && /^\d+$/.test(options.replyToMessageId)
        ? { reply_parameters: { message_id: Number(options.replyToMessageId), allow_sending_without_reply: true } }
        : {}),
    });
    return { externalMessageId: String(result.message_id ?? ""), status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendMediaMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult> {
    const method = { IMAGE: "sendPhoto", VIDEO: "sendVideo", AUDIO: "sendAudio", FILE: "sendDocument" }[mediaType];
    const field = { IMAGE: "photo", VIDEO: "video", AUDIO: "audio", FILE: "document" }[mediaType];
    if (!/^https:\/\//i.test(mediaUrl)) throw new BadRequestError("Telegram media must be an https URL.");
    const result = await telegramCall(credentials, method, { chat_id: recipientId, [field]: mediaUrl, ...(options?.caption ? { caption: options.caption.slice(0, 1024) } : {}) });
    return { externalMessageId: String(result.message_id ?? ""), status: "SENT", providerTimestamp: new Date().toISOString() };
  }

  public async sendTemplateMessage(): Promise<SendMessageResult> {
    throw new BadRequestError("Telegram has no message templates; send a text message instead.");
  }

  public async markMessageRead(): Promise<boolean> {
    return false; // bots can't mark messages read
  }

  public async getUserProfile(): Promise<UserProfileResult | null> {
    return null; // the profile comes with each update (first name, username)
  }

  public async validateCredentials(credentials: ChannelCredentials): Promise<{ valid: boolean; verified?: boolean; error?: string }> {
    const token = typeof credentials.bot_token === "string" ? credentials.bot_token.trim() : "";
    if (!TOKEN_PATTERN.test(token)) return { valid: false, error: "the bot token format is 123456789:ABC..." };
    return { valid: true, verified: false };
  }
}
