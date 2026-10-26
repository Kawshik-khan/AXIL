/**
 * Scheduled jobs (FX-99 Part B): the scheduler holds the clock, CommerceOS holds the decisions and the tenant list.
 *
 * The scheduler (scripts/run-scheduled-jobs.mjs, run by GitHub Actions) calls `POST /api/v1/jobs/{job}/run` with the
 * platform job token. Each job decides which workspaces are due (active, not paused by a kill switch, opted in through
 * their settings, in their own timezone) and returns what it did or found. The scheduler never chooses workspaces or
 * recipients.
 *
 * Each job runs once per time bucket: a repeated call in the same bucket gets the stored result back (`replayed`).
 * Money and stock release never depend on these jobs (payment timers stay in the app worker).
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { AgentHealthService } from "@/domains/platform/services/agent-health.service";
import { RetentionService } from "@/domains/privacy/retention.service";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { CspReportService } from "@/domains/platform/services/csp-report.service";
import type { TenantRecord } from "@/infrastructure/db";
import type { JobRunRecord } from "@/types/commerce";
import { orderRepository } from "@/domains/orders/order.repository";
import { localHour } from "@/lib/local-time";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";
import { NotificationService } from "@/domains/notifications/notification.service";
import { runConnectionHealth } from "@/domains/connectors/connection-lifecycle";
import { findSilentDrops } from "@/domains/ai/customer-agent/silent-drops";

export { localHour };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface JobDefinition {
  /** Length of one bucket: a job runs at most once per bucket. */
  cadenceMs: number;
  run(now: number): Promise<Record<string, unknown>>;
}

const localDate = (tenant: Pick<TenantRecord, "timezone">, at: number | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone || "Asia/Dhaka" }).format(new Date(at));

/** Workspaces a job may act for: active, not paused by a TENANT kill switch (or the global one). */
export function dueTenants(): TenantRecord[] {
  return db.getTenants().filter((t) => t.status === "ACTIVE" && !PlatformSafetyService.isExecutionBlocked("TENANT", t.id));
}

export const JOBS: Record<string, JobDefinition> = {
  /** Shipments in the courier's hands with no update for 6 hours, listed for a status check. */
  "courier-poll": {
    cadenceMs: 30 * MINUTE,
    async run(now) {
      const stale = new Date(now - 6 * HOUR).toISOString();
      const tenants = dueTenants()
        .map((t) => ({
          tenant_id: t.id,
          shipments: db
            .getShipments(t.id)
            .filter((s) => ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status) && s.updated_at < stale && s.booking_mode !== "MANUAL")
            .map((s) => ({ shipment_id: s.id, courier_provider: s.courier_provider, tracking_number: s.tracking_number, consignment_id: s.consignment_id ?? null })),
        }))
        .filter((t) => t.shipments.length);
      return { tenants };
    },
  },

  /** 9 PM in each shop's timezone: the day's numbers, to shops that switched the daily summary on (Settings → Notifications). */
  "daily-report": {
    cadenceMs: HOUR,
    async run(now) {
      const candidates = dueTenants().filter((t) => localHour(t, now) === 21 && NotificationService.wants(t.id, "daily_summary"));
      const results = await Promise.all(
        candidates.map(async (t) => {
          const today = localDate(t, now);
          const fromTime = new Date(now - 26 * HOUR).toISOString();
          const toTime = new Date(now + 2 * HOUR).toISOString();
          const ordersInWindow = await orderRepository.findInWindow(t.id, fromTime, toTime);
          const orders = ordersInWindow.filter((o) => localDate(t, o.created_at) === today);
          const live = orders.filter((o) => o.status !== "CANCELLED");
          const low = (await inventoryRepository.getStockLevels(t.id)).filter((i) => i.reorder_point > 0 && i.quantity_available <= i.reorder_point).length;
          const revenue = live.reduce((n, o) => n + o.grand_total, 0);
          const pendingCount = (await orderRepository.countByTenant(t.id, "PENDING")) || 0;
          const text = `📊 ${t.name}: ${today}\nOrders: ${orders.length} (${orders.length - live.length} cancelled)\nRevenue: ৳${revenue.toLocaleString("en-BD")}\nPending orders: ${pendingCount}\nLow-stock items: ${low}`;
          const delivery = await NotificationService.deliver(t.id, "daily_summary", text);
          return { tenant_id: t.id, date: today, orders: orders.length, revenue_bdt: revenue, pending_orders: pendingCount, low_stock_items: low, delivery: delivery.status };
        })
      );
      return { tenants: results };
    },
  },

  /** 8 AM in each shop's timezone: items at or below their reorder point, as reorder proposals (nothing is ordered). */
  "low-stock": {
    cadenceMs: HOUR,
    async run(now) {
      const due = dueTenants().filter((t) => localHour(t, now) === 8 && NotificationService.wants(t.id, "low_stock"));
      const tenants = [];
      for (const t of due) {
        const low = (await inventoryRepository.getStockLevels(t.id)) // zero-hydration: each shop's stock and catalog
          .filter((i) => i.reorder_point > 0 && i.quantity_available <= i.reorder_point);
        if (!low.length) continue;
        const proposals = low.map((i) => ({
          product_variant_id: i.product_variant_id,
          sku: i.sku,
          name: i.product_name,
          warehouse_id: i.warehouse_id,
          available: i.quantity_available,
          reorder_point: i.reorder_point,
          suggested_quantity: Math.max(1, i.reorder_point * 2 - i.quantity_available),
        }));
        const lines = proposals.slice(0, 15).map((p) => `• ${p.name} (${p.sku}): ${p.available} left, reorder ~${p.suggested_quantity}`);
        const more = proposals.length > 15 ? `\n…and ${proposals.length - 15} more in Inventory.` : "";
        const text = `⚠️ ${t.name}: ${proposals.length} item${proposals.length === 1 ? " is" : "s are"} low on stock\n${lines.join("\n")}${more}\n\nSuggestions only: nothing has been ordered.`;
        const delivery = await NotificationService.deliver(t.id, "low_stock", text);
        tenants.push({ tenant_id: t.id, proposals, delivery: delivery.status });
      }
      return { tenants, note: "Proposals only. A person creates any purchase order." };
    },
  },

  /** Failed deliveries and returns of the last day, for staff follow-up. */
  "rto-followup": {
    cadenceMs: DAY,
    async run(now) {
      const since = new Date(now - DAY).toISOString();
      const tenants = [];
      for (const t of dueTenants().filter((x) => NotificationService.wants(x.id, "failed_deliveries"))) {
        const shipments = db
          .getShipments(t.id)
          .filter((s) => (s.status === "FAILED" || s.status === "RETURNED") && s.updated_at >= since)
          .map((s) => ({ shipment_id: s.id, order_id: s.order_id, status: s.status, courier_provider: s.courier_provider, tracking_number: s.tracking_number }));
        if (!shipments.length) continue;
        const lines = shipments.slice(0, 15).map((s) => `• ${s.status === "RETURNED" ? "Returned" : "Failed"}: ${s.courier_provider} ${s.tracking_number ?? ""}`.trimEnd());
        const more = shipments.length > 15 ? `\n…and ${shipments.length - 15} more in Shipments.` : "";
        const text = `🚚 ${t.name}: ${shipments.length} deliver${shipments.length === 1 ? "y" : "ies"} failed or came back in the last day\n${lines.join("\n")}${more}\n\nCall these customers before re-sending.`;
        const delivery = await NotificationService.deliver(t.id, "failed_deliveries", text);
        tenants.push({ tenant_id: t.id, shipments, delivery: delivery.status });
      }
      return { tenants };
    },
  },

  /** Weekly: cash-on-delivery orders delivered in the last 7 days per courier, to check against the courier's payout. */
  "cod-reconciliation": {
    cadenceMs: 7 * DAY,
    async run(now) {
      const since = new Date(now - 7 * DAY).toISOString();
      const due = dueTenants().filter((t) => NotificationService.wants(t.id, "cod_weekly"));
      for (const t of due) {
        // Zero-hydration: the delivered orders checked below
        const delivered = db.getShipments(t.id).filter((x) => x.status === "DELIVERED" && (x.delivered_at ?? x.updated_at) >= since);
        await loadOrderRows(t.id, delivered.map((s) => s.order_id));
      }
      const tenants = due
        .map((t) => {
          const byCourier = new Map<string, { orders: number; amount_bdt: number; order_ids: string[] }>();
          for (const s of db.getShipments(t.id).filter((x) => x.status === "DELIVERED" && (x.delivered_at ?? x.updated_at) >= since)) {
            const order = db.findOrderById(t.id, s.order_id);
            if (!order || order.payment_method !== "COD") continue;
            const c = byCourier.get(s.courier_provider) ?? { orders: 0, amount_bdt: 0, order_ids: [] };
            c.orders++;
            c.amount_bdt += order.grand_total;
            c.order_ids.push(order.id);
            byCourier.set(s.courier_provider, c);
          }
          return { tenant_id: t.id, name: t.name, couriers: [...byCourier.entries()].map(([courier, c]) => ({ courier, ...c })) };
        })
        .filter((t) => t.couriers.length);
      for (const t of tenants) {
        const lines = t.couriers.map((c) => `• ${c.courier}: ${c.orders} order${c.orders === 1 ? "" : "s"}, ৳${c.amount_bdt.toLocaleString("en-BD")} to collect`);
        const text = `💵 ${t.name}: cash on delivery, last 7 days\n${lines.join("\n")}\n\nCheck these against each courier's payout.`;
        (t as typeof t & { delivery?: string }).delivery = (await NotificationService.deliver(t.tenant_id, "cod_weekly", text)).status;
      }
      return { tenants };
    },
  },

  /** Every 5 minutes: platform health for the owner's Telegram (no customer data). */
  monitoring: {
    cadenceMs: 5 * MINUTE,
    async run(now) {
      const alerts = AgentHealthService.evaluateAlerts(now);
      await CspReportService.load(now); // zero-hydration: the week's CSP counters
      // Customer messages the agent should have answered and nothing did (messaging reliability MR1)
      const drops = await findSilentDrops(dueTenants(), now);
      if (drops.silent) logger.error("messaging.silent_drop", { silent: drops.silent, tenants: drops.tenants });
      return {
        agent_alerts: alerts.map((a) => ({ title: a.title, severity: a.severity, detail: a.detail })),
        csp: CspReportService.summary(now),
        messaging: drops,
        healthy: alerts.length === 0 && drops.silent === 0,
      };
    },
  },

  /** Nightly retention purge (FX-83). */
  "retention-purge": {
    cadenceMs: DAY,
    async run(now) {
      const result = await db.unit(async () => RetentionService.purge(now), () => true);
      return { ...result };
    },
  },

  /** Every 6 hours: sign-in connections' tokens checked with the provider (ADR-119 P4): expiry, revocation, scopes. */
  "connection-health": {
    cadenceMs: 6 * HOUR,
    async run(now) {
      return { ...(await runConnectionHealth(now)) };
    },
  },

  /** Nightly: re-embed knowledge chunks made with another embedding model or size (FX-82), paced. */
  "knowledge-reindex": {
    cadenceMs: DAY,
    async run() {
      return { ...(await KnowledgeService.reembedStaleChunks({ batchSize: 20, pauseMs: 500, maxChunks: 500 })) };
    },
  },
};

export type JobName = keyof typeof JOBS;

const STALE_RUN_MS = 15 * MINUTE;

export function bucketOf(job: string, now: number): string {
  const def = JOBS[job];
  return new Date(Math.floor(now / def.cadenceMs) * def.cadenceMs).toISOString();
}

export class JobsService {
  /**
   * Runs a job for the current bucket once. A second call in the same bucket returns the stored result; a run still
   * going (a scheduler retry) gets 409. Writes happen in the job's own units; the run record in short ones.
   */
  public static async run(job: string, idempotencyKey: string, now = Date.now()): Promise<Record<string, unknown>> {
    const def = Object.prototype.hasOwnProperty.call(JOBS, job) ? JOBS[job] : undefined;
    if (!def) throw new NotFoundError("Job", job);
    const bucket = bucketOf(job, now);
    const id = `${job}:${bucket}`;
    const start = await db.unit(async () => {
      const existing = db.findJobRun(id);
      if (existing?.status === "DONE") return { replay: existing };
      if (existing?.status === "RUNNING" && now - Date.parse(existing.started_at) < STALE_RUN_MS) return { busy: true as const };
      const run: JobRunRecord = { id, job, bucket, status: "RUNNING", idempotency_key: idempotencyKey, started_at: new Date(now).toISOString() };
      db.saveJobRun(run);
      return { run };
    }, (r) => "run" in r);
    if ("replay" in start && start.replay) return { job, bucket, replayed: true, ...(start.replay.result ?? {}) };
    if ("busy" in start) throw new ConflictError(`Job ${job} is already running for ${bucket}.`);

    try {
      const result = await def.run(now);
      await db.unit(async () => (db.saveJobRun({ ...(db.findJobRun(id) as JobRunRecord), status: "DONE", result, finished_at: new Date().toISOString() }), true), () => true);
      logger.info("jobs.run", { job, bucket });
      return { job, bucket, replayed: false, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : "job failed";
      await db.unit(async () => (db.saveJobRun({ ...(db.findJobRun(id) as JobRunRecord), status: "FAILED", error: message, finished_at: new Date().toISOString() }), true), () => true).catch(() => undefined);
      logger.error("jobs.failed", { job, bucket, error: message });
      throw err instanceof AppError ? err : new AppError("JOB_FAILED", `Job ${job} failed.`, 500);
    }
  }
}
