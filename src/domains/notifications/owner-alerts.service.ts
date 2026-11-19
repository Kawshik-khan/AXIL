/**
 * Event alerts for the shop owner (ADR-127): a customer chat handed to a person, a high-value order, a failed online
 * payment. Outbox pattern: `enqueue` runs inside the event's own unit of work (so an alert exists exactly when its
 * event was committed, once per dedupe key) and does no network call; the background worker delivers due alerts.
 *
 * - Only for workspaces that switched the alert on and have a linked chat whose linker may still see the shop.
 * - Quiet hours (shop timezone) defer delivery to the end of the quiet window.
 * - An alert is sent at most once: a worker claims it (SENDING) before calling Telegram, and an alert left SENDING by a
 *   crashed worker is marked FAILED, never re-sent (Telegram may already have it).
 * - Texts carry no customer names or phone numbers (a linked chat may be a group).
 */
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import type { EventAlertKey, OwnerAssistantSettings } from "@/types/notifications";
import type { OwnerAlertRecord } from "@/types/owner-assistant";
import { NotificationService, assistantSettingsOf } from "./notification.service";

const HOUR_MS = 3_600_000;
/** A claim older than this is a worker that died mid-send. */
const STALE_SEND_MS = 2 * 60_000;
const DELIVERIES_PER_PASS = 20;

function localHour(timeZone: string, at: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(at)));
}

function inQuietHours(hour: number, q: OwnerAssistantSettings["quiet_hours"]): boolean {
  if (q.start_hour === q.end_hour) return false;
  return q.start_hour < q.end_hour ? hour >= q.start_hour && hour < q.end_hour : hour >= q.start_hour || hour < q.end_hour;
}

/** When an alert raised at `now` may be delivered: now, or the first full hour after quiet hours end. */
export function deliverAfter(timeZone: string, quiet: OwnerAssistantSettings["quiet_hours"], now = Date.now()): string {
  if (!inQuietHours(localHour(timeZone, now), quiet)) return new Date(now).toISOString();
  const nextHour = Math.ceil((now + 1) / HOUR_MS) * HOUR_MS;
  for (let i = 0; i < 25; i++) {
    const t = nextHour + i * HOUR_MS;
    if (!inQuietHours(localHour(timeZone, t), quiet)) return new Date(t).toISOString();
  }
  return new Date(now).toISOString();
}

export class OwnerAlertService {
  /**
   * Queues an alert for delivery if the workspace wants it. Synchronous and local: call it inside the unit that commits
   * the event. Returns the stored alert, or null when the workspace doesn't want it (or it was already queued).
   */
  public static enqueue(tenantId: string, alertKey: EventAlertKey, text: string, dedupeKey: string): OwnerAlertRecord | null {
    try {
      if (!NotificationService.wants(tenantId, alertKey)) return null;
      const tenant = db.findTenantById(tenantId);
      const settings = assistantSettingsOf(db.findNotificationSettings(tenantId));
      const now = new Date().toISOString();
      const { alert, created } = db.insertOwnerAlertOnce({
        id: `oal_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        tenant_id: tenantId,
        alert_key: alertKey,
        text: text.slice(0, 1000),
        dedupe_key: `${alertKey}:${dedupeKey}`.slice(0, 200),
        status: "PENDING",
        deliver_after: deliverAfter(tenant?.timezone || "Asia/Dhaka", settings.quiet_hours),
        attempts: 0,
        created_at: now,
      });
      return created ? alert : null;
    } catch (err) {
      // An alert must never make the business event fail
      logger.warn("owner_alerts.enqueue_failed", { tenant_id: tenantId, alert: alertKey, error: (err as Error).name });
      return null;
    }
  }

  /** The workspace's high-value order threshold in BDT. */
  public static highValueThreshold(tenantId: string): number {
    return assistantSettingsOf(db.findNotificationSettings(tenantId)).high_value_order_bdt;
  }

  /** One delivery pass: claims due alerts one at a time and sends them. Exported for the worker and tests. */
  public static async dispatchOnce(now = Date.now()): Promise<{ sent: number; not_sent: number; failed: number; abandoned: number }> {
    const stats = { sent: 0, not_sent: 0, failed: 0, abandoned: 0 };
    const nowIso = new Date(now).toISOString();

    // Claims a crashed worker left behind: the send may have happened, so they are never sent again
    const staleBefore = new Date(now - STALE_SEND_MS).toISOString();
    const stale = db.getAllOwnerAlertsInState("SENDING").filter((a) => (a.claimed_at ?? "") < staleBefore);
    if (stale.length) {
      await db.unit(async () => {
        for (const a of stale) {
          const current = db.findOwnerAlert(a.tenant_id, a.id);
          if (current?.status !== "SENDING") continue;
          db.updateOwnerAlert(a.tenant_id, a.id, { status: "FAILED", reason: "Delivery was interrupted; not re-sent in case Telegram already has it." });
          stats.abandoned++;
        }
      }, () => true);
    }

    for (const candidate of db.getDueOwnerAlerts(nowIso, DELIVERIES_PER_PASS)) {
      const claimed = await db
        .unit(async () => {
          const current = db.findOwnerAlert(candidate.tenant_id, candidate.id);
          if (!current || current.status !== "PENDING") return undefined;
          return db.updateOwnerAlert(candidate.tenant_id, candidate.id, { status: "SENDING", claimed_at: new Date().toISOString(), attempts: current.attempts + 1 });
        }, (r) => r !== undefined)
        .catch(() => undefined); // another server claimed it first
      if (!claimed) continue;

      const result = await NotificationService.deliver(claimed.tenant_id, claimed.alert_key as EventAlertKey, claimed.text);
      await db
        .unit(async () => {
          db.updateOwnerAlert(claimed.tenant_id, claimed.id, {
            status: result.status,
            reason: result.reason,
            claimed_at: undefined,
            ...(result.status === "SENT" ? { sent_at: new Date().toISOString() } : {}),
          });
        }, () => true)
        .catch((err: unknown) => logger.warn("owner_alerts.record_failed", { error: (err as Error).name }));
      if (result.status === "SENT") stats.sent++;
      else if (result.status === "NOT_SENT") stats.not_sent++;
      else stats.failed++;
    }
    return stats;
  }
}
