/**
 * CommerceOS Phase 6: Intelligence Ingestion Service
 * Handles event normalization, idempotency protection, and incremental analytical rollup.
 */

import { db } from "@/infrastructure/db";
import { MetricSnapshot } from "@/types/intelligence";

export interface DomainEventInput {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp?: string;
  idempotency_key?: string;
}

export interface IngestionResult {
  ingested: boolean;
  duplicate: boolean;
  event_id: string;
  tenant_id: string;
  rollups_updated: string[];
}

export class IntelligenceIngestionService {
  private processedEventIds: Set<string> = new Set();

  /**
   * Ingests a commerce domain event into the analytical layer with idempotency protection
   */
  public async ingestEvent(event: DomainEventInput): Promise<IngestionResult> {
    if (!event.tenant_id) {
      throw new Error("Cannot ingest event: tenant_id is required.");
    }
    if (!event.id) {
      throw new Error("Cannot ingest event: event id is required.");
    }

    const eventKey = `${event.tenant_id}:${event.id}`;
    const idempotencyKey = event.idempotency_key || event.id;

    // 1. Check idempotency
    const existingEvents = db.getAnalyticsEvents(event.tenant_id);
    const isDuplicate =
      this.processedEventIds.has(eventKey) ||
      existingEvents.some((e) => e.id === event.id || (e.payload?.idempotency_key === idempotencyKey && idempotencyKey));

    if (isDuplicate) {
      return {
        ingested: false,
        duplicate: true,
        event_id: event.id,
        tenant_id: event.tenant_id,
        rollups_updated: [],
      };
    }

    // 2. Persist to analytics_events
    const eventRecord = {
      id: event.id,
      tenant_id: event.tenant_id,
      event_type: event.type,
      payload: { ...event.payload, idempotency_key: idempotencyKey },
      created_at: event.timestamp || new Date().toISOString(),
    };
    db.insertAnalyticsEvent(eventRecord);
    this.processedEventIds.add(eventKey);

    // 3. Incremental rollups based on event type
    const rollupsUpdated: string[] = [];
    const eventDate = (event.timestamp || new Date().toISOString()).slice(0, 10);

    if (event.type.startsWith("order.")) {
      rollupsUpdated.push("orders_count");
      if (event.payload.total_amount && typeof event.payload.total_amount === "number") {
        rollupsUpdated.push("gross_revenue");
        this.updateDailySnapshot(event.tenant_id, "gross_revenue", eventDate, event.payload.total_amount);
      }
    } else if (event.type.startsWith("payment.")) {
      if (event.type === "payment.completed" && typeof event.payload.amount === "number") {
        rollupsUpdated.push("net_revenue");
        this.updateDailySnapshot(event.tenant_id, "net_revenue", eventDate, event.payload.amount);
      }
    } else if (event.type.startsWith("inventory.")) {
      rollupsUpdated.push("inventory_movements");
    }

    return {
      ingested: true,
      duplicate: false,
      event_id: event.id,
      tenant_id: event.tenant_id,
      rollups_updated: rollupsUpdated,
    };
  }

  private updateDailySnapshot(tenantId: string, metricKey: string, date: string, addValue: number): void {
    const existing = db
      .getMetricSnapshots(tenantId, metricKey)
      .find((s) => s.period_start.startsWith(date) && s.granularity === "DAY");

    if (existing) {
      existing.value += addValue;
      existing.sample_count += 1;
    } else {
      const snap: MetricSnapshot = {
        id: `snap_${metricKey}_${date}_${tenantId}`,
        tenant_id: tenantId,
        metric_key: metricKey,
        period_start: `${date}T00:00:00.000Z`,
        period_end: `${date}T23:59:59.999Z`,
        granularity: "DAY",
        value: addValue,
        sample_count: 1,
        created_at: new Date().toISOString(),
      };
      db.insertMetricSnapshot(snap);
    }
  }
}

export const intelligenceIngestionService = new IntelligenceIngestionService();
