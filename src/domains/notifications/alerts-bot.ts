/**
 * The CommerceOS alerts bot: one Telegram bot for the whole platform that sends merchants their owner alerts (daily
 * summary, low stock, failed deliveries, COD check). Not a shop's own customer-facing bot.
 *
 * Configured by one variable, TELEGRAM_ALERTS_BOT_TOKEN (from @BotFather). The webhook secret is derived from it, so
 * there is nothing else to set; the webhook itself is registered the first time a merchant asks to connect.
 * Every call goes through the SSRF-guarded client (telegramCall).
 */
import crypto from "crypto";
import { telegramCall, TELEGRAM_SECRET_HEADER } from "@/domains/social/channels/adapters/telegram.adapter";
import { appBaseUrl } from "@/domains/social/n8n/bridge";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const ALERTS_WEBHOOK_PATH = "/api/v1/notifications/telegram/webhook";
export { TELEGRAM_SECRET_HEADER };

export class AlertsBotNotConfiguredError extends AppError {
  constructor(reason: string) {
    super("ALERTS_BOT_NOT_CONFIGURED", `Telegram alerts aren't available on this server yet (${reason}).`, 503);
  }
}

function botToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.TELEGRAM_ALERTS_BOT_TOKEN?.trim();
  return token ? token : null;
}

export function alertsBotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return botToken(env) !== null;
}

/** The secret Telegram sends back on every webhook call (X-Telegram-Bot-Api-Secret-Token), derived from the token. */
export function alertsWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = botToken(env);
  return token ? crypto.createHmac("sha256", token).update("commerceos-alerts-webhook").digest("hex") : null;
}

/** Whether a webhook call carries the expected secret (constant time). */
export function isAlertsWebhookCall(header: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = alertsWebhookSecret(env);
  if (!expected || !header) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(header).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Calls the Bot API as the alerts bot. */
export async function alertsBotCall(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = botToken();
  if (!token) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
  return telegramCall({ bot_token: token }, method, params);
}

let usernameCache: { token: string; username: string } | null = null;

/** The bot's @username (for the t.me link), asked from Telegram once per token. Null when it can't be read now. */
export async function alertsBotUsername(): Promise<string | null> {
  const token = botToken();
  if (!token) return null;
  if (usernameCache?.token === token) return usernameCache.username;
  try {
    const me = await alertsBotCall("getMe", {});
    const username = typeof me.username === "string" ? me.username : null;
    if (username) usernameCache = { token, username };
    return username;
  } catch (err) {
    logger.warn("notifications.alerts_bot_getme_failed", { error: err instanceof AppError ? err.code : "error" });
    return null;
  }
}

let webhookRegisteredFor: string | null = null;

/**
 * Points the bot's webhook at this app (once per process and token; Telegram accepts the same call again harmlessly).
 * Needs APP_URL to be this app's https address.
 */
export async function ensureAlertsWebhook(): Promise<void> {
  const token = botToken();
  if (!token) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
  if (webhookRegisteredFor === token) return;
  const base = appBaseUrl();
  if (!base || !base.startsWith("https://")) throw new AlertsBotNotConfiguredError("APP_URL is not this app's https address");
  await alertsBotCall("setWebhook", {
    url: `${base}${ALERTS_WEBHOOK_PATH}`,
    secret_token: alertsWebhookSecret(),
    allowed_updates: ["message"],
  });
  webhookRegisteredFor = token;
}

/** Tests: forget the cached username and webhook registration. */
export function resetAlertsBotForTesting(): void {
  usernameCache = null;
  webhookRegisteredFor = null;
}
