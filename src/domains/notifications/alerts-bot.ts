/**
 * The CommerceOS alerts bot: sends merchants their owner alerts (daily summary, low stock, failed deliveries, COD
 * check). Can use the platform-wide TELEGRAM_ALERTS_BOT_TOKEN (from @BotFather), a workspace-configured alerts bot
 * token (Settings → Notifications), or the workspace's connected Telegram bot from Connectors.
 *
 * The webhook secret is derived from the active token; every call goes through the SSRF-guarded client (telegramCall).
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { decryptCredential } from "@/lib/security";
import { telegramCall, TELEGRAM_SECRET_HEADER } from "@/domains/social/channels/adapters/telegram.adapter";
import { appBaseUrl } from "@/lib/app-url";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const ALERTS_WEBHOOK_PATH = "/api/v1/notifications/telegram/webhook";
export { TELEGRAM_SECRET_HEADER };

export class AlertsBotNotConfiguredError extends AppError {
  constructor(reason: string) {
    super("ALERTS_BOT_NOT_CONFIGURED", `Telegram alerts aren't available on this server yet (${reason}).`, 503);
  }
}

export type AlertsBotSource = "platform" | "workspace" | "connector";

export interface ResolvedAlertsBot {
  token: string;
  source: AlertsBotSource;
  savedUsername?: string;
}

function platformBotToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.TELEGRAM_ALERTS_BOT_TOKEN?.trim();
  return token ? token : null;
}

export function resolveAlertsBot(tenantId?: string, env: NodeJS.ProcessEnv = process.env): ResolvedAlertsBot | null {
  if (tenantId) {
    const settings = db.findNotificationSettings(tenantId);
    if (settings?.bot_token_encrypted) {
      try {
        const decrypted = decryptCredential<{ bot_token?: string }>(settings.bot_token_encrypted);
        const token = typeof decrypted.bot_token === "string" ? decrypted.bot_token.trim() : "";
        if (token) return { token, source: "workspace", savedUsername: settings.bot_username };
      } catch {
        // unreadable secret: fall through
      }
    }
  }
  const platform = platformBotToken(env);
  if (platform) return { token: platform, source: "platform" };
  if (tenantId) {
    const connector = db.findConnectorByProvider(tenantId, "telegram");
    if (connector && connector.status === "ACTIVE" && connector.enabled !== false && connector.credentials_encrypted) {
      try {
        const creds = decryptCredential<{ bot_token?: string }>(connector.credentials_encrypted);
        const token = typeof creds.bot_token === "string" ? creds.bot_token.trim() : "";
        if (token) return { token, source: "connector" };
      } catch {
        // unreadable connector secret
      }
    }
  }
  return null;
}

export function alertsBotConfigured(env: NodeJS.ProcessEnv = process.env, tenantId?: string): boolean {
  return resolveAlertsBot(tenantId, env) !== null;
}

export function secretForAlertsToken(token: string): string {
  return crypto.createHmac("sha256", token).update("commerceos-alerts-webhook").digest("hex");
}

/** The secret Telegram sends back on every webhook call (X-Telegram-Bot-Api-Secret-Token), derived from the token. */
export function alertsWebhookSecret(env: NodeJS.ProcessEnv = process.env, tenantId?: string): string | null {
  const resolved = resolveAlertsBot(tenantId, env);
  return resolved ? secretForAlertsToken(resolved.token) : null;
}

function matchesSecretConstantTime(expected: string, header: string): boolean {
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(header).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Whether a webhook call carries the expected secret (constant time) for the platform bot or a workspace alerts bot. */
export function isAlertsWebhookCall(header: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!header) return false;
  const platformExpected = alertsWebhookSecret(env);
  if (platformExpected && matchesSecretConstantTime(platformExpected, header)) return true;
  for (const rec of db.getAllNotificationSettings()) {
    if (!rec.bot_token_encrypted) continue;
    try {
      const decrypted = decryptCredential<{ bot_token?: string }>(rec.bot_token_encrypted);
      const token = typeof decrypted.bot_token === "string" ? decrypted.bot_token.trim() : "";
      if (token && matchesSecretConstantTime(secretForAlertsToken(token), header)) return true;
    } catch {
      // ignore unreadable row
    }
  }
  return false;
}

/** Calls the Bot API as the alerts bot (for a workspace when tenantId is given, or the platform bot). */
export async function alertsBotCall(
  method: string,
  params: Record<string, unknown>,
  tenantId?: string
): Promise<Record<string, unknown>> {
  const resolved = resolveAlertsBot(tenantId);
  if (!resolved) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
  return telegramCall({ bot_token: resolved.token }, method, params);
}

let usernameCache: { token: string; username: string } | null = null;

/** The bot's @username (for the t.me link), asked from Telegram once per token. Null when it can't be read now. */
export async function alertsBotUsername(tenantId?: string): Promise<string | null> {
  const resolved = resolveAlertsBot(tenantId);
  if (!resolved) return null;
  if (resolved.savedUsername) return resolved.savedUsername;
  if (usernameCache?.token === resolved.token) return usernameCache.username;
  try {
    const me = await alertsBotCall("getMe", {}, tenantId);
    const username = typeof me.username === "string" ? me.username : null;
    if (username) usernameCache = { token: resolved.token, username };
    return username;
  } catch (err) {
    logger.warn("notifications.alerts_bot_getme_failed", { error: err instanceof AppError ? err.code : "error" });
    return null;
  }
}

let webhookRegisteredFor: string | null = null;

/**
 * Points the bot's webhook at this app when APP_URL is https (once per process and token; Telegram accepts the same
 * call again harmlessly). When APP_URL is http (e.g. localhost development), linking falls back to polling getUpdates
 * during the waiting window instead of failing, and a workspace's connected customer bot keeps its own connector webhook.
 */
export async function ensureAlertsWebhook(tenantId?: string): Promise<void> {
  const resolved = resolveAlertsBot(tenantId);
  if (!resolved) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
  if (resolved.source === "connector") return;
  if (webhookRegisteredFor === resolved.token) return;
  const base = appBaseUrl();
  if (!base || !base.startsWith("https://")) return;
  await alertsBotCall(
    "setWebhook",
    {
      url: `${base}${ALERTS_WEBHOOK_PATH}`,
      secret_token: secretForAlertsToken(resolved.token),
      allowed_updates: ["message"],
    },
    tenantId
  );
  webhookRegisteredFor = resolved.token;
}

/** Tests: forget the cached username and webhook registration. */
export function resetAlertsBotForTesting(): void {
  usernameCache = null;
  webhookRegisteredFor = null;
}
