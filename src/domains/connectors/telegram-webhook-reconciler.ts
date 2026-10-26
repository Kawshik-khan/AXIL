/**
 * Telegram webhook reconciler (messaging reliability MR3, FX-102). Registering a bot's webhook is a one-time call to
 * Telegram; nothing used to check it afterwards, so a connector recreated after a database cutover left Telegram
 * posting to an id that no longer existed (a 500 retried for minutes, every message lost).
 *
 * Every run asks Telegram what each enabled, connected Telegram connector's webhook is:
 * - pointing at this app's URL for the connector, no recent error, no backlog: HEALTHY;
 * - pointing at this app under another connector id (a deleted or pre-cutover connector): registered again;
 * - unset, or pointing anywhere else (the shop may route the bot through another service or poll it): reported, never touched;
 * - erroring recently, backlogged, or Telegram unreachable: DEGRADED with a code (never Telegram's text).
 */
import { db } from "@/infrastructure/db";
import type { TenantRecord } from "@/infrastructure/db";
import { decryptCredential } from "@/lib/security";
import { appBaseUrl } from "@/lib/app-url";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { telegramCall } from "@/domains/social/channels/adapters/telegram.adapter";
import { ConnectorService } from "./service";
import type { ConnectorConfigRecord } from "@/types/connector";

export const RECONCILER_ACTOR = "system:webhook-reconciler";
/** An error Telegram reported within this window means deliveries are failing now. */
const RECENT_ERROR_MS = 60 * 60_000;
/** Updates waiting at Telegram beyond this mean the app isn't taking them. */
const BACKLOG_LIMIT = 50;

export type ReconcileResult = "HEALTHY" | "REREGISTERED" | "MISMATCH_NOT_OURS" | "DEGRADED";

export interface ReconcileItem {
  tenant_id: string;
  connector_id: string;
  result: ReconcileResult;
  code?: string;
}

export interface ReconcileReport {
  skipped?: "APP_URL_NOT_HTTPS";
  checked: number;
  healthy: number;
  reregistered: number;
  degraded: number;
  items: ReconcileItem[];
}

export async function reconcileTelegramWebhooks(tenants: readonly TenantRecord[], now = Date.now()): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, healthy: 0, reregistered: 0, degraded: 0, items: [] };
  const base = appBaseUrl();
  if (!base || !base.startsWith("https://")) return { ...report, skipped: "APP_URL_NOT_HTTPS" };

  for (const tenant of tenants) {
    const channels = db.getConnectedChannels(tenant.id);
    const connectors = db
      .getConnectors(tenant.id)
      .filter((c) => c.provider_id === "telegram" && c.enabled !== false && channels.some((ch) => ch.connector_id === c.id));
    for (const connector of connectors) {
      const item = await reconcileOne(tenant.id, connector, `${base}/api/v1/connectors/${connector.id}/webhook`, now);
      report.checked++;
      if (item.result === "HEALTHY") report.healthy++;
      else if (item.result === "REREGISTERED") report.reregistered++;
      else report.degraded++;
      report.items.push(item);
    }
  }
  return report;
}

async function reconcileOne(tenantId: string, connector: ConnectorConfigRecord, expectedUrl: string, now: number): Promise<ReconcileItem> {
  const base = { tenant_id: tenantId, connector_id: connector.id };
  let info: Record<string, unknown>;
  try {
    info = await telegramCall(decryptCredential<Record<string, unknown>>(connector.credentials_encrypted), "getWebhookInfo", {});
  } catch (err) {
    return record({ ...base, result: "DEGRADED", code: err instanceof AppError ? err.code : "TELEGRAM_ERROR" }, now);
  }

  if (info.url !== expectedUrl) {
    // Only a webhook still pointing at this app under another (deleted) connector id is taken back. Unset, or anywhere
    // else (another automation service, a poller), is the bot owner's choice even if this app registered it once: reported, never overridden.
    const prefix = expectedUrl.slice(0, expectedUrl.length - `${connector.id}/webhook`.length);
    const staleOfThisApp = typeof info.url === "string" && info.url.startsWith(prefix) && /^[A-Za-z0-9_-]+\/webhook$/.test(info.url.slice(prefix.length));
    if (!staleOfThisApp) {
      return record({ ...base, result: "MISMATCH_NOT_OURS", code: info.url ? "WEBHOOK_ELSEWHERE" : "WEBHOOK_NOT_SET" }, now);
    }
    try {
      await ConnectorService.registerTelegramWebhook(tenantId, connector, RECONCILER_ACTOR, "stale_connector_id");
      logger.warn("connector_webhook.reregistered", { tenant_id: tenantId, connector_id: connector.id, was_set: Boolean(info.url) });
      return record({ ...base, result: "REREGISTERED" }, now);
    } catch (err) {
      return record({ ...base, result: "DEGRADED", code: err instanceof AppError ? err.code : "REREGISTER_FAILED" }, now);
    }
  }

  const lastErrorAt = typeof info.last_error_date === "number" ? info.last_error_date * 1000 : 0;
  if (lastErrorAt && now - lastErrorAt < RECENT_ERROR_MS) return record({ ...base, result: "DEGRADED", code: "WEBHOOK_ERRORING" }, now);
  if (typeof info.pending_update_count === "number" && info.pending_update_count > BACKLOG_LIMIT) {
    return record({ ...base, result: "DEGRADED", code: "WEBHOOK_BACKLOG" }, now);
  }
  return record({ ...base, result: "HEALTHY" }, now);
}

/** The connector page shows the outcome: health and a code, never Telegram's own text. */
async function record(item: ReconcileItem, now: number): Promise<ReconcileItem> {
  const healthy = item.result === "HEALTHY" || item.result === "REREGISTERED";
  await db.unit(async () => {
    const current = db.findConnectorById(item.tenant_id, item.connector_id);
    if (!current) return false;
    db.saveConnector({
      ...current,
      health_status: healthy ? "HEALTHY" : "DEGRADED",
      health_code: healthy ? undefined : item.code,
      health_checked_at: new Date(now).toISOString(),
    });
    return true;
  }, (saved) => saved);
  if (!healthy) logger.warn("connector_webhook.degraded", { tenant_id: item.tenant_id, connector_id: item.connector_id, result: item.result, code: item.code });
  return item;
}
