/**
 * Domain-event outbox dispatcher (FX-99 Part B). Runs in the background worker (src/domains/ai/customer-agent/worker.ts):
 * claims due outbox rows in a short unit of work, delivers each to the automation router OUTSIDE the store lock, and
 * records the outcome in another unit.
 * - At least once: a claim left by a crashed server is taken again after 5 minutes.
 * - In order per aggregate: the store only offers the oldest undelivered row of each order / shipment / item.
 * - Deduplicated: the row's id is the source event's id; the router's n8n call is idempotent per automation and event.
 * - Retries with backoff (30 s, 1, 2, 4 min), then DEAD after 5 attempts (counted by the monitoring job).
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import type { DomainEventOutboxRecord } from "@/types/commerce";
import { AutomationRouterService } from "@/domains/automation/services/automation-router.service";

const STALE_CLAIM_MS = 5 * 60_000;
export const MAX_DISPATCH_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

async function claim(row: DomainEventOutboxRecord, now: number): Promise<DomainEventOutboxRecord | undefined> {
  return db.unit(async () => {
    const current = db.findDomainEvent(row.tenant_id, row.id);
    if (!current) return undefined;
    const due = current.status === "PENDING" && current.next_attempt_at <= new Date(now).toISOString();
    const stale = current.status === "DISPATCHING" && (current.claimed_at ?? "") < new Date(now - STALE_CLAIM_MS).toISOString();
    if (!due && !stale) return undefined;
    return db.saveDomainEvent({ ...current, status: "DISPATCHING", claimed_at: new Date(now).toISOString(), attempts: current.attempts + 1 });
  }, (r) => Boolean(r));
}

/** One pass. Exported for tests and the worker. */
export async function dispatchOutboxOnce(limit = 20, now = Date.now()): Promise<{ delivered: number; failed: number; dead: number }> {
  const stats = { delivered: 0, failed: 0, dead: 0 };
  const due = db.getDueDomainEvents(new Date(now).toISOString(), new Date(now - STALE_CLAIM_MS).toISOString(), limit);
  for (const candidate of due) {
    const row = await claim(candidate, now).catch(() => undefined); // another server took it
    if (!row) continue;
    let error: string | undefined;
    try {
      const results = await AutomationRouterService.routeEvent({
        id: row.id, type: row.type, version: "1.0", tenant_id: row.tenant_id, aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id, actor_id: row.actor_id, correlation_id: row.correlation_id, timestamp: row.occurred_at, payload: row.payload,
      });
      // A run the kill switch cancelled was decided, not failed: retrying it would only be cancelled again
      const failedRuns = results.filter((r) => !r.success && r.status !== "CANCELLED");
      if (failedRuns.length) error = `${failedRuns.length} automation(s) failed: ${failedRuns.map((r) => r.status).join(", ")}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "dispatch failed";
    }
    await db.unit(async () => {
      const current = db.findDomainEvent(row.tenant_id, row.id) ?? row;
      if (!error) {
        db.saveDomainEvent({ ...current, status: "DISPATCHED", dispatched_at: new Date().toISOString(), last_error: undefined, claimed_at: undefined });
        stats.delivered++;
      } else if (current.attempts >= MAX_DISPATCH_ATTEMPTS) {
        db.saveDomainEvent({ ...current, status: "DEAD", last_error: error, claimed_at: undefined });
        logger.error("outbox.dead_letter", { tenant_id: row.tenant_id, event_id: row.id, type: row.type, attempts: current.attempts });
        stats.dead++;
      } else {
        const wait = BASE_BACKOFF_MS * 2 ** (current.attempts - 1);
        db.saveDomainEvent({ ...current, status: "PENDING", last_error: error, claimed_at: undefined, next_attempt_at: new Date(Date.now() + wait).toISOString() });
        stats.failed++;
      }
      return true;
    }, () => true);
  }
  return stats;
}
