/**
 * Merchant notifications (owner alerts): a workspace connects one Telegram chat (a person or a group) to the CommerceOS
 * alerts bot by pressing Start on a one-time link, chooses its alerts, and the scheduled jobs deliver them.
 *
 * - The tenant always comes from the session, except in the bot webhook, where a chat proves it may be linked by
 *   presenting the one-time code (144 random bits, stored only as a SHA-256, single use, valid 15 minutes).
 * - Nothing is reported as sent unless Telegram accepted the message.
 * - Message text is plain (no parse mode), so shop or product names can't inject formatting or links.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { AuditService } from "@/domains/audit/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError, ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { checkRateLimit, MINUTE } from "@/lib/rate-limit";
import { decryptCredential, encryptCredential } from "@/lib/security";
import { telegramCall } from "@/domains/social/channels/adapters/telegram.adapter";
import type { RequestContext } from "@/lib/context";
import {
  DEFAULT_NOTIFICATION_ALERTS,
  DEFAULT_OWNER_ASSISTANT_SETTINGS,
  type NotificationAlertKey,
  type NotificationAlerts,
  type NotificationDeliveryResult,
  type NotificationSettingsRecord,
  type OwnerAssistantSettings,
} from "@/types/notifications";
import {
  alertsBotCall,
  alertsBotConfigured,
  alertsBotUsername,
  ensureAlertsWebhook,
  newWorkspaceWebhookIdentity,
  platformAlertsBotId,
  telegramBotIdOf,
  workspaceAlertsBotToken,
  AlertsBotNotConfiguredError,
  type AlertsBotScope,
} from "./alerts-bot";
import { MAX_QUESTION_CHARS, ownerPrincipalFor, telegramChatKey } from "@/domains/ai/owner-assistant/owner-assistant.service";

const LINK_TTL_MS = 15 * 60_000;
const START_COMMAND = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{16,64})\s*$/;
const STOP_COMMAND = /^\/stop(?:@[A-Za-z0-9_]+)?\s*$/;
const FORGET_COMMAND = /^\/forget(?:@[A-Za-z0-9_]+)?\s*$/;
const HELP_COMMAND = /^\/help(?:@[A-Za-z0-9_]+)?\s*$/;
/** Questions per linked chat (Owner Assistant, ADR-127). */
const QUESTIONS_PER_WINDOW = 20;
const QUESTION_WINDOW_MS = 10 * MINUTE;

export const ALERT_LABELS: Record<NotificationAlertKey, string> = {
  daily_summary: "Daily summary at 9 PM",
  low_stock: "Low-stock alert at 8 AM",
  failed_deliveries: "Failed and returned deliveries, daily",
  cod_weekly: "Weekly cash-on-delivery check",
  chat_escalated: "A customer chat needs a person (as it happens)",
  new_order_high_value: "High-value orders (as they happen)",
  payment_failed: "Failed online payments (as they happen)",
};

const ASK_HINT =
  'Ask me about your shop here, e.g. "How much did I sell today?", "What is low on stock?", "আজ কত বিক্রি হলো?". /forget clears our chat.';

/** The workspace's Owner Assistant settings, defaults filled in. */
export function assistantSettingsOf(record: NotificationSettingsRecord | undefined): OwnerAssistantSettings {
  return {
    ...DEFAULT_OWNER_ASSISTANT_SETTINGS,
    ...(record?.assistant ?? {}),
    quiet_hours: { ...DEFAULT_OWNER_ASSISTANT_SETTINGS.quiet_hours, ...(record?.assistant?.quiet_hours ?? {}) },
  };
}

export interface NotificationSettingsView {
  bot: { configured: boolean; username: string | null };
  /** paused: connected, but the person who linked it no longer has access, so nothing is sent until someone reconnects. */
  telegram: { connected: boolean; chat_label: string | null; linked_at: string | null; paused: boolean };
  alerts: NotificationAlerts;
  assistant: OwnerAssistantSettings;
  pending_link_expires_at: string | null;
  last_test_at: string | null;
  /** The caller may change these settings (settings.update); otherwise the page shows them read-only. */
  can_manage: boolean;
}

const hashCode = (code: string) => crypto.createHash("sha256").update(code, "utf8").digest("hex");

function recordFor(tenantId: string): NotificationSettingsRecord {
  const now = new Date().toISOString();
  return db.findNotificationSettings(tenantId) ?? { id: `ns_${tenantId}`, tenant_id: tenantId, alerts: { ...DEFAULT_NOTIFICATION_ALERTS }, created_at: now, updated_at: now };
}

function save(record: NotificationSettingsRecord): NotificationSettingsRecord {
  return db.saveNotificationSettings({ ...record, updated_at: new Date().toISOString() });
}

/**
 * A chat keeps getting a shop's figures only while the person who linked it may still see them: an active account
 * with an active membership in that workspace whose role has settings.read. Removing or suspending them, or a role
 * change, stops the alerts without anyone having to remember the chat.
 */
function linkerStillAllowed(record: NotificationSettingsRecord): boolean {
  const userId = record.telegram?.linked_by_user_id;
  if (!userId) return false;
  const user = db.findUserById(userId);
  if (!user || user.status !== "ACTIVE") return false;
  const membership = db.findMembership(record.tenant_id, userId);
  if (!membership || membership.status === "SUSPENDED") return false;
  return (ROLE_PERMISSIONS[membership.role] ?? []).includes(PERMISSIONS.SETTINGS_READ);
}

/**
 * The notification records an update from this bot may act on: a workspace bot only its own workspace; the platform
 * bot only workspaces that use it (no bot of their own). A forged update signed with one workspace's bot secret can
 * never link, unlink, forget or ask in another workspace's chat (ADR-127 security review H1).
 */
function recordsInScope(scope: AlertsBotScope): NotificationSettingsRecord[] {
  return db.getAllNotificationSettings().filter((r) => (scope.kind === "tenant" ? r.tenant_id === scope.tenantId : !r.bot_token_encrypted));
}

/** The workspace alerts bot's id (stored, or read from a token saved before ids were stored). */
function alertsBotIdOf(record: NotificationSettingsRecord): string | null {
  if (record.bot_id) return record.bot_id;
  const token = workspaceAlertsBotToken(record);
  return token ? telegramBotIdOf(token) : null;
}

/** Whether a bot answers customers: a Telegram channel of any workspace, or this workspace's Telegram connector. */
function isCustomerBot(tenantId: string, botId: string): boolean {
  if (db.findConnectedChannelsByProviderId("TELEGRAM", botId).length > 0) return true;
  const connector = db.findConnectorByProvider(tenantId, "telegram");
  if (!connector?.credentials_encrypted) return false;
  try {
    const creds = decryptCredential<{ bot_token?: unknown }>(connector.credentials_encrypted);
    return typeof creds.bot_token === "string" && telegramBotIdOf(creds.bot_token) === botId;
  } catch {
    return false;
  }
}

/** A replaced or removed alerts bot stops calling us: its webhook (and the old secret with it) is deleted. Best effort. */
async function retireWebhook(token: string): Promise<void> {
  await telegramCall({ bot_token: token }, "deleteWebhook", {}).catch((err: unknown) =>
    logger.warn("notifications.alerts_bot_retire_failed", { code: err instanceof AppError ? err.code : "error" })
  );
}

/**
 * Whether the linked chat is on the bot that serves the workspace now: a chat that pressed Start on the platform bot
 * can't be reached by the workspace's own bot, and the other way round (ADR-128). Chats linked before this was
 * recorded are assumed to be on the current bot.
 */
export function chatOnCurrentBot(record: NotificationSettingsRecord): boolean {
  const via = record.telegram?.via;
  if (!via) return true;
  return via === (record.bot_token_encrypted ? "workspace" : "platform");
}

/** Help and "link expired" replies: a few per chat per minute, so a flood can't spend the bot's shared send quota. */
async function replyAllowed(chatId: string): Promise<boolean> {
  return (await checkRateLimit(`notifications:tg-reply:${chatId}`, 3, MINUTE)).allowed;
}

async function sendTo(chatId: string, text: string, tenantId?: string): Promise<NotificationDeliveryResult> {
  try {
    await alertsBotCall("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, tenantId);
    return { status: "SENT" };
  } catch (err) {
    if (err instanceof AlertsBotNotConfiguredError) return { status: "NOT_SENT", reason: "Telegram alerts aren't set up on this server yet." };
    const reason = err instanceof AppError ? err.message : "Telegram could not be reached.";
    logger.warn("notifications.telegram_send_failed", { code: err instanceof AppError ? err.code : "error" });
    return { status: "FAILED", reason };
  }
}

export class NotificationService {
  /** What the Notifications settings page shows. Read-only: nothing is stored here (GETs never write). */
  public static async getSettings(context: RequestContext): Promise<NotificationSettingsView> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const tenantId = context.tenant.id;
    const record = recordFor(tenantId);
    const pending = record.link && Date.parse(record.link.expires_at) > Date.now() ? record.link.expires_at : null;
    const configured = alertsBotConfigured(process.env, tenantId);
    return {
      bot: { configured, username: configured ? await alertsBotUsername(tenantId) : null },
      telegram: {
        connected: Boolean(record.telegram),
        chat_label: record.telegram?.chat_label ?? null,
        linked_at: record.telegram?.linked_at ?? null,
        paused: Boolean(record.telegram) && (!linkerStillAllowed(record) || !chatOnCurrentBot(record)),
      },
      alerts: { ...DEFAULT_NOTIFICATION_ALERTS, ...record.alerts },
      assistant: assistantSettingsOf(record),
      pending_link_expires_at: pending,
      last_test_at: record.last_test_at ?? null,
      can_manage: RbacService.can(context, PERMISSIONS.SETTINGS_UPDATE),
    };
  }

  public static updateAlerts(context: RequestContext, patch: Partial<NotificationAlerts>): NotificationAlerts {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const record = recordFor(context.tenant.id);
    const alerts = { ...DEFAULT_NOTIFICATION_ALERTS, ...record.alerts, ...patch };
    save({ ...record, alerts });
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "NOTIFICATION_ALERTS_UPDATED",
      resourceType: "notification_settings",
      resourceId: record.id,
      metadata: { alerts: patch },
    });
    return alerts;
  }

  /** Owner Assistant settings for the linked chat: questions on/off, group questions, high-value threshold, quiet hours. */
  public static updateAssistant(context: RequestContext, patch: Partial<OwnerAssistantSettings>): OwnerAssistantSettings {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const record = recordFor(context.tenant.id);
    const current = assistantSettingsOf(record);
    const next: OwnerAssistantSettings = {
      ...current,
      ...patch,
      quiet_hours: { ...current.quiet_hours, ...(patch.quiet_hours ?? {}) },
    };
    save({ ...record, assistant: next });
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "OWNER_ASSISTANT_SETTINGS_UPDATED",
      resourceType: "notification_settings",
      resourceId: record.id,
      metadata: { assistant: patch },
    });
    return next;
  }

  /**
   * Configures or clears a workspace-specific Telegram alerts bot token from Settings → Notifications.
   * Validates the token live via Telegram's `getMe` before storing it encrypted at rest.
   */
  public static async configureBot(
    context: RequestContext,
    botTokenInput: string | null
  ): Promise<{ configured: boolean; username: string | null }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    const record = recordFor(tenantId);
    const trimmed = typeof botTokenInput === "string" ? botTokenInput.trim() : "";
    const previousToken = workspaceAlertsBotToken(record);
    const previousBotId = record.bot_id ?? (previousToken ? telegramBotIdOf(previousToken) : null);
    // A chat that pressed Start on another bot can't hear from (or ask) this one: it has to connect again
    const chatOnOldBot = Boolean(record.telegram) && record.telegram?.via !== "platform";

    if (!trimmed) {
      save({
        ...record,
        bot_token_encrypted: undefined,
        bot_username: undefined,
        bot_id: undefined,
        bot_webhook_key: undefined,
        bot_webhook_secret_encrypted: undefined,
        link: undefined,
        ...(chatOnOldBot ? { telegram: undefined } : {}),
      });
      if (previousToken) await retireWebhook(previousToken);
      AuditService.log({
        tenantId,
        actorUserId: context.user.id,
        action: "NOTIFICATION_ALERTS_BOT_REMOVED",
        resourceType: "notification_settings",
        resourceId: record.id,
        metadata: { chat_disconnected: chatOnOldBot },
      });
      const configured = alertsBotConfigured(process.env, tenantId);
      return { configured, username: configured ? await alertsBotUsername(tenantId) : null };
    }

    // Two bots, two roles (ADR-128): the owner's alerts bot is never a customer bot, the platform bot, or another
    // workspace's alerts bot
    const botId = telegramBotIdOf(trimmed);
    if (!botId) throw new BadRequestError("That doesn't look like a Telegram bot token (it looks like 123456789:AA…).");
    if (botId === platformAlertsBotId()) {
      throw new ConflictError("That is the CommerceOS alerts bot. Leave this empty to use it; save your own bot only if you want a separate one.");
    }
    if (isCustomerBot(tenantId, botId)) {
      throw new ConflictError("This bot answers your customers (Connectors → Telegram). Create a second bot in @BotFather for owner alerts.");
    }
    if (db.getAllNotificationSettings().some((r) => r.tenant_id !== tenantId && alertsBotIdOf(r) === botId)) {
      throw new ConflictError("This bot is already used for another CommerceOS workspace's alerts.");
    }

    const me = await telegramCall({ bot_token: trimmed }, "getMe", {});
    const username = typeof me.username === "string" ? me.username : null;
    if (!username) {
      throw new BadRequestError("Telegram did not return a bot username for this token.");
    }

    const sameBot = previousBotId === botId;
    // A new random webhook address and secret every save: saving again rotates them
    save({
      ...record,
      bot_token_encrypted: encryptCredential({ bot_token: trimmed }),
      bot_username: username,
      bot_id: botId,
      ...newWorkspaceWebhookIdentity(),
      // Any chat linked through another bot (the platform bot or the old one) can't be reached by this one
      ...(sameBot ? {} : { link: undefined, telegram: undefined }),
    });
    if (previousToken && !sameBot) await retireWebhook(previousToken);
    // Register the new address and secret now (https only); the next Connect or Send test retries if this fails
    await ensureAlertsWebhook(tenantId).catch((err: unknown) =>
      logger.warn("notifications.alerts_bot_webhook_failed", { code: err instanceof AppError ? err.code : "error" })
    );
    AuditService.log({
      tenantId,
      actorUserId: context.user.id,
      action: "NOTIFICATION_ALERTS_BOT_CONFIGURED",
      resourceType: "notification_settings",
      resourceId: record.id,
      metadata: { bot_username: username, bot_changed: !sameBot, chat_disconnected: !sameBot && Boolean(record.telegram) },
    });
    return { configured: true, username };
  }

  /**
   * A one-time link to the alerts bot: opening it and pressing Start links that chat to this workspace. Replaces any
   * earlier pending link. `group_url` adds the bot to a Telegram group instead (alerts for a whole team).
   */
  public static async createTelegramLink(context: RequestContext): Promise<{ url: string; group_url: string; expires_at: string }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    if (!alertsBotConfigured(process.env, tenantId)) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
    const username = await alertsBotUsername(tenantId);
    if (!username) throw new AppError("TELEGRAM_UNREACHABLE", "Telegram could not be reached. Try again in a moment.", 502);
    await ensureAlertsWebhook(tenantId);
    const code = crypto.randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
    const record = recordFor(tenantId);
    save({ ...record, link: { code_hash: hashCode(code), expires_at: expiresAt, requested_by_user_id: context.user.id } });
    return {
      url: `https://t.me/${username}?start=${code}`,
      group_url: `https://t.me/${username}?startgroup=${code}`,
      expires_at: expiresAt,
    };
  }

  /**
   * Polls Telegram `getUpdates` for a pending `/start <code>` when a webhook cannot reach this server (e.g. localhost
   * HTTP development). Called by `PUT /api/v1/notifications/telegram/link` while the UI waits for Start.
   */
  public static async pollPendingLink(context: RequestContext): Promise<{ linked: boolean; chat_label: string | null }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const tenantId = context.tenant.id;
    const record = db.findNotificationSettings(tenantId);
    if (record?.telegram) return { linked: true, chat_label: record.telegram.chat_label };
    if (!record?.link || Date.parse(record.link.expires_at) <= Date.now() || !alertsBotConfigured(process.env, tenantId)) {
      return { linked: false, chat_label: null };
    }
    try {
      const raw = await alertsBotCall("getUpdates", { allowed_updates: ["message"], limit: 25 }, tenantId);
      const updates = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
      for (const update of updates) {
        const message = update.message as { text?: unknown } | undefined;
        const text = typeof message?.text === "string" ? message.text.trim() : "";
        const start = START_COMMAND.exec(text);
        if (start && hashCode(start[1]) === record.link.code_hash) {
          await NotificationService.handleTelegramUpdate(update, { kind: "tenant", tenantId });
          if (typeof update.update_id === "number") {
            await alertsBotCall("getUpdates", { offset: update.update_id + 1, limit: 1 }, tenantId).catch(() => undefined);
          }
          break;
        }
      }
    } catch {
      // If a webhook is active on Telegram (409 Conflict) or network fails, rely on the webhook path
    }
    const updated = db.findNotificationSettings(tenantId);
    return { linked: Boolean(updated?.telegram), chat_label: updated?.telegram?.chat_label ?? null };
  }

  /** Whether an incoming Telegram update is a `/start <code>` for a pending notification link or `/stop` for a linked alert chat. */
  public static isNotificationCommand(update: unknown): boolean {
    const message = (update as { message?: Record<string, unknown> } | null)?.message;
    const chat = message?.chat as { id?: number | string } | undefined;
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    if (!chat || chat.id === undefined || chat.id === null) return false;
    const start = START_COMMAND.exec(text);
    if (start) {
      const codeHash = hashCode(start[1]);
      return db.getAllNotificationSettings().some((r) => r.link?.code_hash === codeHash);
    }
    if (STOP_COMMAND.test(text)) {
      const chatId = String(chat.id);
      return db.getAllNotificationSettings().some((r) => r.telegram?.chat_id === chatId);
    }
    return false;
  }

  public static async disconnectTelegram(context: RequestContext): Promise<void> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    const record = db.findNotificationSettings(tenantId);
    if (!record || (!record.telegram && !record.link)) return;
    const chatId = record.telegram?.chat_id;
    // A pending link is cancelled too, so a code pasted into the wrong chat stops working at once
    save({ ...record, telegram: undefined, link: undefined });
    AuditService.log({
      tenantId,
      actorUserId: context.user.id,
      action: chatId ? "NOTIFICATION_TELEGRAM_DISCONNECTED" : "NOTIFICATION_TELEGRAM_LINK_CANCELLED",
      resourceType: "notification_settings",
      resourceId: record.id,
      metadata: {},
    });
    if (!chatId) return;
    // Courtesy message; the disconnect stands whether or not Telegram takes it
    await sendTo(chatId, `This chat will no longer get ${context.tenant.name} alerts from CommerceOS.`, tenantId);
  }

  /** Sends a test message to the connected chat, whatever the alert switches say. */
  public static async sendTest(context: RequestContext): Promise<NotificationDeliveryResult> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    const record = db.findNotificationSettings(tenantId);
    if (!record?.telegram) throw new BadRequestError("Connect Telegram first.");
    if (!chatOnCurrentBot(record)) throw new BadRequestError("This chat was connected to a different bot. Connect Telegram again.");
    // Registers the bot's webhook with its random secret (moves a bot saved before random secrets off the old one)
    await ensureAlertsWebhook(tenantId).catch((err: unknown) =>
      logger.warn("notifications.alerts_bot_webhook_failed", { code: err instanceof AppError ? err.code : "error" })
    );
    const result = await sendTo(
      record.telegram.chat_id,
      `✅ Test from CommerceOS: ${context.tenant.name} alerts will arrive in this chat.`,
      tenantId
    );
    // Re-read: registering the webhook above may have stored a new address and secret on the record
    if (result.status === "SENT") save({ ...(db.findNotificationSettings(tenantId) ?? record), last_test_at: new Date().toISOString() });
    return result;
  }

  /**
   * Delivers one alert to a workspace: only when it is switched on and a chat is connected. Used by the scheduled jobs
   * (src/domains/jobs/jobs.service.ts); never throws.
   */
  public static async deliver(tenantId: string, alert: NotificationAlertKey, text: string): Promise<NotificationDeliveryResult> {
    const record = db.findNotificationSettings(tenantId);
    if (!record?.telegram) return { status: "NOT_SENT", reason: "Telegram is not connected" };
    if (!{ ...DEFAULT_NOTIFICATION_ALERTS, ...record.alerts }[alert]) return { status: "NOT_SENT", reason: "This alert is switched off" };
    if (!linkerStillAllowed(record)) return { status: "NOT_SENT", reason: "The person who connected this chat no longer has access; reconnect it" };
    if (!chatOnCurrentBot(record)) return { status: "NOT_SENT", reason: "This chat was connected to a different bot; connect Telegram again" };
    return sendTo(record.telegram.chat_id, text, tenantId);
  }

  /** Whether a workspace wants this alert and has somewhere to receive it (the jobs skip the rest). */
  public static wants(tenantId: string, alert: NotificationAlertKey): boolean {
    const record = db.findNotificationSettings(tenantId);
    return Boolean(record?.telegram) && Boolean({ ...DEFAULT_NOTIFICATION_ALERTS, ...record?.alerts }[alert]) && linkerStillAllowed(record!) && chatOnCurrentBot(record!);
  }

  /** Replies in a linked chat (the Owner Assistant's answers). Never throws; SENT only when Telegram accepted it. */
  public static async replyInChat(tenantId: string, chatId: string, text: string, replyToMessageId?: number): Promise<NotificationDeliveryResult> {
    try {
      await alertsBotCall(
        "sendMessage",
        {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } } : {}),
        },
        tenantId,
      );
      return { status: "SENT" };
    } catch (err) {
      if (err instanceof AlertsBotNotConfiguredError) return { status: "NOT_SENT", reason: "Telegram alerts aren't set up on this server yet." };
      logger.warn("owner_assistant.telegram_reply_failed", { code: err instanceof AppError ? err.code : "error" });
      return { status: "FAILED", reason: err instanceof AppError ? err.message : "Telegram could not be reached." };
    }
  }

  /**
   * A question in a linked chat (Owner Assistant, ADR-127). Stored PENDING for the background worker, which answers it
   * as the person who linked the chat, with that person's current permissions. Nothing is computed here: the webhook
   * stays short and never calls the model inside its store unit.
   */
  private static async queueOwnerQuestion(
    scope: AlertsBotScope,
    chatId: string,
    chat: { type?: string },
    message: Record<string, unknown>,
    text: string,
  ): Promise<{ handled: string } | undefined> {
    const linked = recordsInScope(scope).filter((r) => r.telegram?.chat_id === chatId);
    if (linked.length === 0) return undefined; // not a linked chat: the usual help reply
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    if (linked.length > 1) {
      if (!isGroup && (await replyAllowed(chatId))) await sendTo(chatId, "This chat is connected to more than one shop, so I can't tell which shop you mean. Questions work in a chat connected to one shop.", linked[0].tenant_id);
      return { handled: "AMBIGUOUS_CHAT" };
    }
    const record = linked[0];
    const settings = assistantSettingsOf(record);
    if (!settings.questions_enabled) return { handled: "QUESTIONS_OFF" };

    let question = text;
    if (isGroup) {
      if (!settings.group_questions) return { handled: "GROUP_QUESTIONS_OFF" };
      const username = await alertsBotUsername(record.tenant_id);
      const mention = username ? new RegExp(`@${username.replace(/[^A-Za-z0-9_]/g, "")}\\b`, "i") : null;
      const replyTo = message.reply_to_message as { from?: { is_bot?: boolean; username?: string } } | undefined;
      const repliedToBot = Boolean(replyTo?.from?.is_bot && username && replyTo.from.username?.toLowerCase() === username.toLowerCase());
      if (!(mention && mention.test(text)) && !repliedToBot) return { handled: "NOT_ADDRESSED" };
      if (mention) question = text.replace(mention, "").trim();
    }
    if (!question) return { handled: "IGNORED" };

    // The person who linked the chat: still a member, still allowed to see the shop's figures and use the AI
    const principal = linkerStillAllowed(record) ? ownerPrincipalFor(record.tenant_id, record.telegram!.linked_by_user_id) : undefined;
    if (!principal || !principal.permissions.includes(PERMISSIONS.AI_RUN)) {
      if (await replyAllowed(chatId)) await sendTo(chatId, "Questions are paused for this chat: the person who connected it can no longer use the assistant. Reconnect it from Settings → Notifications.", record.tenant_id);
      return { handled: "LINKER_NOT_ALLOWED" };
    }

    // Telegram re-delivers an update it thinks we missed: one message is one question (security review L2)
    const messageId = typeof message.message_id === "number" ? message.message_id : undefined;
    if (messageId !== undefined && db.getOwnerAssistantTurns(record.tenant_id, telegramChatKey(chatId), 50).some((t) => t.telegram_message_id === messageId)) {
      return { handled: "DUPLICATE" };
    }

    const limit = await checkRateLimit(`owner-assistant:tg:${chatId}`, QUESTIONS_PER_WINDOW, QUESTION_WINDOW_MS);
    if (!limit.allowed) {
      if (await replyAllowed(chatId)) await sendTo(chatId, "That's a lot of questions at once. Please try again in a few minutes.", record.tenant_id);
      return { handled: "RATE_LIMITED" };
    }

    db.insertOwnerAssistantTurn({
      id: `oat_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      tenant_id: record.tenant_id,
      channel: "TELEGRAM",
      chat_key: telegramChatKey(chatId),
      user_id: principal.userId,
      question: question.slice(0, MAX_QUESTION_CHARS),
      status: "PENDING",
      attempts: 0,
      ...(messageId !== undefined ? { telegram_message_id: messageId } : {}),
      created_at: new Date().toISOString(),
    });
    return { handled: "QUESTION_QUEUED" };
  }

  /**
   * An update from Telegram for the alerts bot (already authenticated by its webhook secret). Handles
   * `/start <code>` (link this chat to the workspace that made the code) and `/stop` (unlink this chat everywhere);
   * anything else gets a short help reply in private chats and is ignored in groups.
   */
  public static async handleTelegramUpdate(update: unknown, scope: AlertsBotScope): Promise<{ handled: string }> {
    const message = (update as { message?: Record<string, unknown> } | null)?.message;
    const chat = message?.chat as { id?: number | string; type?: string; title?: string; username?: string; first_name?: string } | undefined;
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    if (!chat || chat.id === undefined || chat.id === null) return { handled: "IGNORED" };
    const chatId = String(chat.id);
    const from = message?.from as { username?: string; first_name?: string } | undefined;

    const start = START_COMMAND.exec(text);
    if (start) {
      const codeHash = hashCode(start[1]);
      const record = recordsInScope(scope).find((r) => r.link?.code_hash === codeHash);
      if (!record || !record.link || Date.parse(record.link.expires_at) <= Date.now()) {
        if (await replyAllowed(chatId)) await sendTo(chatId, "This link has expired or was already used. Open Settings → Notifications in CommerceOS and press Connect Telegram again.", record?.tenant_id);
        return { handled: "LINK_INVALID" };
      }
      const label = chat.title ? chat.title : chat.username ? `@${chat.username}` : from?.username ? `@${from.username}` : chat.first_name || from?.first_name || "Telegram chat";
      const tenant = db.findTenantById(record.tenant_id);
      save({
        ...record,
        link: undefined,
        telegram: {
          chat_id: chatId,
          chat_label: label.slice(0, 80),
          linked_at: new Date().toISOString(),
          linked_by_user_id: record.link.requested_by_user_id,
          // Which bot the chat pressed Start on: only that bot reaches it from now on (ADR-128)
          via: scope.kind === "platform" ? "platform" : record.bot_token_encrypted ? "workspace" : "platform",
          ...(scope.kind === "platform" ? (platformAlertsBotId() ? { bot_id: platformAlertsBotId()! } : {}) : record.bot_id ? { bot_id: record.bot_id } : {}),
        },
      });
      AuditService.log({
        tenantId: record.tenant_id,
        actorUserId: record.link.requested_by_user_id,
        action: "NOTIFICATION_TELEGRAM_CONNECTED",
        resourceType: "notification_settings",
        resourceId: record.id,
        metadata: { chat_type: chat.type ?? "unknown" },
      });
      const on = (Object.keys(ALERT_LABELS) as NotificationAlertKey[]).filter((k) => ({ ...DEFAULT_NOTIFICATION_ALERTS, ...record.alerts })[k]);
      const settings = assistantSettingsOf(record);
      const isGroup = chat.type === "group" || chat.type === "supergroup";
      const askLine = settings.questions_enabled && (!isGroup || settings.group_questions) ? `\n\n${ASK_HINT}` : "";
      await sendTo(
        chatId,
        `✅ Connected to ${tenant?.name ?? "your shop"} on CommerceOS.\n\nYou'll get:\n${on.map((k) => `• ${ALERT_LABELS[k]}`).join("\n") || "• (no alerts are on yet)"}\n\nChange them anytime in Settings → Notifications. Send /stop to turn alerts off here.${askLine}`,
        record.tenant_id
      );
      return { handled: "LINKED" };
    }

    if (FORGET_COMMAND.test(text)) {
      const linked = recordsInScope(scope).filter((r) => r.telegram?.chat_id === chatId);
      let removed = 0;
      for (const record of linked) removed += db.deleteOwnerAssistantTurns(record.tenant_id, telegramChatKey(chatId));
      if (linked.length && (await replyAllowed(chatId))) await sendTo(chatId, removed ? "Done. I've forgotten our earlier questions and answers." : "There was nothing to forget.", linked[0].tenant_id);
      return { handled: linked.length ? "FORGOTTEN" : "NOT_LINKED" };
    }

    if (HELP_COMMAND.test(text)) {
      const linked = recordsInScope(scope).filter((r) => r.telegram?.chat_id === chatId);
      if (await replyAllowed(chatId)) {
        await sendTo(chatId, linked.length ? `I send shop alerts from CommerceOS and answer questions about your shop. ${ASK_HINT} /stop turns alerts off.` : "I send shop alerts from CommerceOS. To connect, open Settings → Notifications in CommerceOS and press Connect Telegram.", linked[0]?.tenant_id);
      }
      return { handled: "HELP" };
    }

    if (text && !text.startsWith("/")) {
      const queued = await NotificationService.queueOwnerQuestion(scope, chatId, chat, message ?? {}, text);
      if (queued) return queued;
    }

    if (STOP_COMMAND.test(text)) {
      const linked = recordsInScope(scope).filter((r) => r.telegram?.chat_id === chatId);
      const firstTenantId = linked[0]?.tenant_id;
      for (const record of linked) {
        save({ ...record, telegram: undefined });
        AuditService.log({
          tenantId: record.tenant_id,
          actorUserId: "telegram", // whoever sent /stop in that chat; Telegram users aren't workspace users
          action: "NOTIFICATION_TELEGRAM_DISCONNECTED",
          resourceType: "notification_settings",
          resourceId: record.id,
          metadata: { via: "telegram_stop", chat_type: chat.type ?? "unknown" },
        });
      }
      await sendTo(chatId, linked.length ? "Alerts are off for this chat. Reconnect anytime from Settings → Notifications." : "This chat isn't connected to any shop.", firstTenantId);
      return { handled: linked.length ? "UNLINKED" : "NOT_LINKED" };
    }

    if (chat.type === "private") {
      if (await replyAllowed(chatId)) await sendTo(chatId, "I send shop alerts from CommerceOS. To connect, open Settings → Notifications in CommerceOS and press Connect Telegram.");
      return { handled: "HELP" };
    }
    return { handled: "IGNORED" };
  }
}
