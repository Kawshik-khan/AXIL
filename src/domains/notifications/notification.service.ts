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
import { AppError, BadRequestError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { checkRateLimit, MINUTE } from "@/lib/rate-limit";
import type { RequestContext } from "@/lib/context";
import {
  DEFAULT_NOTIFICATION_ALERTS,
  type NotificationAlertKey,
  type NotificationAlerts,
  type NotificationDeliveryResult,
  type NotificationSettingsRecord,
} from "@/types/notifications";
import { alertsBotCall, alertsBotConfigured, alertsBotUsername, ensureAlertsWebhook, AlertsBotNotConfiguredError } from "./alerts-bot";

const LINK_TTL_MS = 15 * 60_000;
const START_COMMAND = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{16,64})\s*$/;
const STOP_COMMAND = /^\/stop(?:@[A-Za-z0-9_]+)?\s*$/;

export const ALERT_LABELS: Record<NotificationAlertKey, string> = {
  daily_summary: "Daily summary at 9 PM",
  low_stock: "Low-stock alert at 8 AM",
  failed_deliveries: "Failed and returned deliveries, daily",
  cod_weekly: "Weekly cash-on-delivery check",
};

export interface NotificationSettingsView {
  bot: { configured: boolean; username: string | null };
  /** paused: connected, but the person who linked it no longer has access, so nothing is sent until someone reconnects. */
  telegram: { connected: boolean; chat_label: string | null; linked_at: string | null; paused: boolean };
  alerts: NotificationAlerts;
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

/** Help and "link expired" replies: a few per chat per minute, so a flood can't spend the bot's shared send quota. */
async function replyAllowed(chatId: string): Promise<boolean> {
  return (await checkRateLimit(`notifications:tg-reply:${chatId}`, 3, MINUTE)).allowed;
}

async function sendTo(chatId: string, text: string): Promise<NotificationDeliveryResult> {
  try {
    await alertsBotCall("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
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
    const record = recordFor(context.tenant.id);
    const pending = record.link && Date.parse(record.link.expires_at) > Date.now() ? record.link.expires_at : null;
    return {
      bot: { configured: alertsBotConfigured(), username: alertsBotConfigured() ? await alertsBotUsername() : null },
      telegram: {
        connected: Boolean(record.telegram),
        chat_label: record.telegram?.chat_label ?? null,
        linked_at: record.telegram?.linked_at ?? null,
        paused: Boolean(record.telegram) && !linkerStillAllowed(record),
      },
      alerts: { ...DEFAULT_NOTIFICATION_ALERTS, ...record.alerts },
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

  /**
   * A one-time link to the alerts bot: opening it and pressing Start links that chat to this workspace. Replaces any
   * earlier pending link. `group_url` adds the bot to a Telegram group instead (alerts for a whole team).
   */
  public static async createTelegramLink(context: RequestContext): Promise<{ url: string; group_url: string; expires_at: string }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    if (!alertsBotConfigured()) throw new AlertsBotNotConfiguredError("TELEGRAM_ALERTS_BOT_TOKEN is not set");
    const username = await alertsBotUsername();
    if (!username) throw new AppError("TELEGRAM_UNREACHABLE", "Telegram could not be reached. Try again in a moment.", 502);
    await ensureAlertsWebhook();
    const code = crypto.randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
    const record = recordFor(context.tenant.id);
    save({ ...record, link: { code_hash: hashCode(code), expires_at: expiresAt, requested_by_user_id: context.user.id } });
    return {
      url: `https://t.me/${username}?start=${code}`,
      group_url: `https://t.me/${username}?startgroup=${code}`,
      expires_at: expiresAt,
    };
  }

  public static async disconnectTelegram(context: RequestContext): Promise<void> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const record = db.findNotificationSettings(context.tenant.id);
    if (!record || (!record.telegram && !record.link)) return;
    const chatId = record.telegram?.chat_id;
    // A pending link is cancelled too, so a code pasted into the wrong chat stops working at once
    save({ ...record, telegram: undefined, link: undefined });
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: chatId ? "NOTIFICATION_TELEGRAM_DISCONNECTED" : "NOTIFICATION_TELEGRAM_LINK_CANCELLED",
      resourceType: "notification_settings",
      resourceId: record.id,
      metadata: {},
    });
    if (!chatId) return;
    // Courtesy message; the disconnect stands whether or not Telegram takes it
    await sendTo(chatId, `This chat will no longer get ${context.tenant.name} alerts from CommerceOS.`);
  }

  /** Sends a test message to the connected chat, whatever the alert switches say. */
  public static async sendTest(context: RequestContext): Promise<NotificationDeliveryResult> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const record = db.findNotificationSettings(context.tenant.id);
    if (!record?.telegram) throw new BadRequestError("Connect Telegram first.");
    const result = await sendTo(
      record.telegram.chat_id,
      `✅ Test from CommerceOS: ${context.tenant.name} alerts will arrive in this chat.`
    );
    if (result.status === "SENT") save({ ...record, last_test_at: new Date().toISOString() });
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
    return sendTo(record.telegram.chat_id, text);
  }

  /** Whether a workspace wants this alert and has somewhere to receive it (the jobs skip the rest). */
  public static wants(tenantId: string, alert: NotificationAlertKey): boolean {
    const record = db.findNotificationSettings(tenantId);
    return Boolean(record?.telegram) && Boolean({ ...DEFAULT_NOTIFICATION_ALERTS, ...record?.alerts }[alert]) && linkerStillAllowed(record!);
  }

  /**
   * An update from Telegram for the alerts bot (already authenticated by its webhook secret). Handles
   * `/start <code>` (link this chat to the workspace that made the code) and `/stop` (unlink this chat everywhere);
   * anything else gets a short help reply in private chats and is ignored in groups.
   */
  public static async handleTelegramUpdate(update: unknown): Promise<{ handled: string }> {
    const message = (update as { message?: Record<string, unknown> } | null)?.message;
    const chat = message?.chat as { id?: number | string; type?: string; title?: string; username?: string; first_name?: string } | undefined;
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    if (!chat || chat.id === undefined || chat.id === null) return { handled: "IGNORED" };
    const chatId = String(chat.id);
    const from = message?.from as { username?: string; first_name?: string } | undefined;

    const start = START_COMMAND.exec(text);
    if (start) {
      const codeHash = hashCode(start[1]);
      const record = db.getAllNotificationSettings().find((r) => r.link?.code_hash === codeHash);
      if (!record || !record.link || Date.parse(record.link.expires_at) <= Date.now()) {
        if (await replyAllowed(chatId)) await sendTo(chatId, "This link has expired or was already used. Open Settings → Notifications in CommerceOS and press Connect Telegram again.");
        return { handled: "LINK_INVALID" };
      }
      const label = chat.title ? chat.title : chat.username ? `@${chat.username}` : from?.username ? `@${from.username}` : chat.first_name || from?.first_name || "Telegram chat";
      const tenant = db.findTenantById(record.tenant_id);
      save({
        ...record,
        link: undefined,
        telegram: { chat_id: chatId, chat_label: label.slice(0, 80), linked_at: new Date().toISOString(), linked_by_user_id: record.link.requested_by_user_id },
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
      await sendTo(
        chatId,
        `✅ Connected to ${tenant?.name ?? "your shop"} on CommerceOS.\n\nYou'll get:\n${on.map((k) => `• ${ALERT_LABELS[k]}`).join("\n") || "• (no alerts are on yet)"}\n\nChange them anytime in Settings → Notifications. Send /stop to turn alerts off here.`
      );
      return { handled: "LINKED" };
    }

    if (STOP_COMMAND.test(text)) {
      const linked = db.getAllNotificationSettings().filter((r) => r.telegram?.chat_id === chatId);
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
      await sendTo(chatId, linked.length ? "Alerts are off for this chat. Reconnect anytime from Settings → Notifications." : "This chat isn't connected to any shop.");
      return { handled: linked.length ? "UNLINKED" : "NOT_LINKED" };
    }

    if (chat.type === "private") {
      if (await replyAllowed(chatId)) await sendTo(chatId, "I send shop alerts from CommerceOS. To connect, open Settings → Notifications in CommerceOS and press Connect Telegram.");
      return { handled: "HELP" };
    }
    return { handled: "IGNORED" };
  }
}
