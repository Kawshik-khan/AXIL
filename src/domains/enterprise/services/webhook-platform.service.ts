import crypto from "crypto";
import { randomSuffix } from "@/lib/ids";
/**
 * Enterprise outbound webhooks, delivered for real (FIX_IMPLEMENTATION_PLAN FX-54, ADR-110).
 *
 * - Subscribe: the target must be an https URL that passes the SSRF guard; the signing secret is shown once.
 * - Outbox: the workspace's commerce events (everything recorded through db.recordEvent) are queued per matching
 *   subscription, one delivery per (subscription, event) — the delivery id is derived from both, so two servers
 *   queuing the same event produce one delivery.
 * - Delivery: POST of a JSON envelope, signed (X-CommerceOS-Signature over "<timestamp>.<body>", see
 *   src/lib/outbound-signing.ts), 10 s deadline, no redirects. 2xx = DELIVERED. Otherwise retried with backoff
 *   (~30 s, 2 min, 10 min, 1 h, 6 h) up to the subscription's retry_count_max, then DEAD_LETTERED (retry by hand).
 *   20 failed deliveries in a row pause the subscription (resume by hand).
 * - Several servers: a delivery is claimed in a unit of work before it is sent (ADR-109), so only one server sends
 *   it; a claim expires after 60 s if that server stops. Delivery is at-least-once: receivers dedupe on
 *   X-CommerceOS-Event-Id.
 */
import { db } from "@/infrastructure/db";
import { BadRequestError, NotFoundError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertSafeUrl, outboundRequest } from "@/lib/outbound-http";
import { signOutbound } from "@/lib/outbound-signing";
import { EnterpriseWebhookSubscription, WebhookDeliveryRecord } from "@/types/enterprise";
import type { CommerceEvent } from "@/types/commerce";

const DELIVERY_TIMEOUT_MS = 10_000;
const CLAIM_MS = 60_000;
const PAUSE_AFTER_CONSECUTIVE_FAILURES = 20;
const DEFAULT_ATTEMPTS = 6;
/** Delay before attempt n+1 (after attempt n failed), before jitter. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** Events are re-scanned from a little before the saved position: an event another server recorded can arrive late. */
const OUTBOX_OVERLAP_MS = 120_000;
const OUTBOX_BATCH = 500;

export interface WebhookRunSummary {
  queued: number;
  attempted: number;
  delivered: number;
  failed: number;
}

function deliveryIdFor(subscriptionId: string, eventId: string): string {
  return `whd_${crypto.createHash("sha256").update(`${subscriptionId}|${eventId}`).digest("hex").slice(0, 32)}`;
}

function matches(sub: EnterpriseWebhookSubscription, eventType: string): boolean {
  return sub.event_types.includes("*") || sub.event_types.includes(eventType);
}

export class WebhookPlatformService {
  /**
   * Registers a subscription. The target must be https and must not resolve to a private, loopback or link-local
   * address. The returned record carries the signing secret; it is never returned again.
   */
  public async subscribe(
    orgId: string,
    params: {
      targetUrl: string;
      eventTypes: string[];
      applicationId?: string;
    }
  ): Promise<EnterpriseWebhookSubscription> {
    if (typeof params.targetUrl !== "string" || !params.targetUrl.trim()) throw new BadRequestError("A webhook URL is required.");
    const url = await assertSafeUrl(params.targetUrl.trim());
    const eventTypes = [...new Set(params.eventTypes)].filter((t) => /^(\*|[a-z_]+(\.[a-z_]+)+)$/.test(t));
    if (!eventTypes.length || eventTypes.length !== params.eventTypes.length) {
      throw new BadRequestError('Event types look like "order.created" (or "*" for every event).');
    }
    const now = new Date().toISOString();
    const sub: EnterpriseWebhookSubscription = {
      id: `whsub_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      application_id: params.applicationId,
      target_url: url.toString(),
      secret: `whsec_${crypto.randomBytes(24).toString("hex")}`,
      event_types: eventTypes,
      status: "ACTIVE",
      retry_count_max: DEFAULT_ATTEMPTS,
      failed_consecutive_deliveries: 0,
      // Only events from now on are delivered (no backfill of history)
      events_queued_through: now,
      created_at: now,
      updated_at: now,
    };
    return db.createEnterpriseWebhook(sub);
  }

  /**
   * Queues an event for every matching ACTIVE subscription of the organization (the worker sends it). Commerce events
   * are queued automatically by the outbox; this is for events that are not commerce events.
   */
  public async dispatchEvent(params: { organizationId: string; eventType: string; payload: Record<string, unknown> }): Promise<WebhookDeliveryRecord[]> {
    const event: CommerceEvent = {
      id: `evt_${Date.now()}_${randomSuffix()}`,
      type: params.eventType,
      version: "1",
      tenant_id: db.findOrganizationById(params.organizationId)?.tenant_id ?? "",
      aggregate_type: "enterprise",
      aggregate_id: params.organizationId,
      timestamp: new Date().toISOString(),
      payload: params.payload,
    };
    return db
      .getEnterpriseWebhooks(params.organizationId)
      .filter((s) => s.status === "ACTIVE" && matches(s, params.eventType))
      .map((sub) => this.queue(sub, event))
      .filter((d): d is WebhookDeliveryRecord => d !== null);
  }

  /** One delivery of `event` to `sub`, unless it exists already (the id is derived from both). */
  private queue(sub: EnterpriseWebhookSubscription, event: CommerceEvent): WebhookDeliveryRecord | null {
    const id = deliveryIdFor(sub.id, event.id);
    if (db.findWebhookDelivery(id)) return null;
    const payload = JSON.stringify({
      event_id: event.id,
      event_type: event.type,
      organization_id: sub.organization_id,
      timestamp: event.timestamp,
      data: event.payload,
    });
    const now = new Date().toISOString();
    return db.createWebhookDelivery({
      id,
      subscription_id: sub.id,
      organization_id: sub.organization_id,
      source_event_id: event.id,
      event_id: event.id,
      event_type: event.type,
      target_url: sub.target_url,
      payload_json: payload,
      signature: "",
      duration_ms: null,
      attempt_number: 0,
      status: "PENDING",
      next_attempt_at: now,
      delivered_at: now,
      created_at: now,
    });
  }

  /** Outbox: new commerce events of each subscription's workspace become deliveries. */
  public enqueueFromEvents(): number {
    let queued = 0;
    for (const sub of db.getAllEnterpriseWebhooks()) {
      if (sub.status !== "ACTIVE") continue;
      const tenantId = db.findOrganizationById(sub.organization_id)?.tenant_id;
      if (!tenantId) continue;
      const position = sub.events_queued_through ?? sub.created_at;
      const since = new Date(Date.parse(position) - OUTBOX_OVERLAP_MS).toISOString();
      const events = db.getEventsSince(tenantId, since, OUTBOX_BATCH);
      let through = position;
      for (const event of events) {
        if (event.timestamp < sub.created_at) continue;
        if (matches(sub, event.type) && this.queue(sub, event)) queued++;
        if (event.timestamp > through) through = event.timestamp;
      }
      // Only as far as the newest event seen, never to "now": an event another server recorded (its clock may be a
      // little behind) must still be found by the next pass
      if (through !== sub.events_queued_through) db.updateEnterpriseWebhook(sub.organization_id, sub.id, { events_queued_through: through });
    }
    return queued;
  }

  /**
   * Claims a due delivery for this server (a unit of work: with several servers exactly one wins; the others get a
   * conflict and skip it). Returns the claimed record, or null.
   */
  private async claim(deliveryId: string, now: Date): Promise<WebhookDeliveryRecord | null> {
    try {
      return await db.unit(
        async () => {
          const d = db.findWebhookDelivery(deliveryId);
          if (!d) return null;
          const nowIso = now.toISOString();
          const due =
            d.status === "PENDING" ||
            (d.status === "RETRY_SCHEDULED" && (!d.next_attempt_at || d.next_attempt_at <= nowIso)) ||
            (d.status === "IN_FLIGHT" && !!d.claimed_until && d.claimed_until < nowIso);
          if (!due) return null;
          const sub = db.findEnterpriseWebhook(d.organization_id ?? "", d.subscription_id);
          if (!sub || sub.status !== "ACTIVE") return null;
          return db.updateWebhookDelivery(d.id, {
            status: "IN_FLIGHT",
            claimed_until: new Date(now.getTime() + CLAIM_MS).toISOString(),
            attempt_number: d.attempt_number + 1,
          });
        },
        () => true
      );
    } catch (err) {
      if (isAppError(err) && err.statusCode === 409) return null; // another server claimed it
      throw err;
    }
  }

  /** Sends one claimed delivery and records the outcome. */
  private async send(delivery: WebhookDeliveryRecord): Promise<boolean> {
    const orgId = delivery.organization_id ?? "";
    const sub = db.findEnterpriseWebhook(orgId, delivery.subscription_id);
    if (!sub) return false;
    const started = Date.now();
    let status: number | undefined;
    let error: string | undefined;
    const signed = signOutbound(sub.secret, delivery.payload_json);
    try {
      const res = await outboundRequest(sub.target_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CommerceOS-Webhooks/1",
          "X-CommerceOS-Event-Id": delivery.event_id,
          "X-CommerceOS-Event-Type": delivery.event_type,
          "X-CommerceOS-Delivery-Id": delivery.id,
          ...signed,
        },
        body: delivery.payload_json,
        timeoutMs: DELIVERY_TIMEOUT_MS,
        maxResponseBytes: 16 * 1024,
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP_${res.status}`;
    } catch (err) {
      error = isAppError(err) ? err.code : "OUTBOUND_UNREACHABLE";
    }
    const duration = Date.now() - started;
    const at = new Date().toISOString();
    const ok = !error;
    await db.unit(
      async () => {
        const current = db.findWebhookDelivery(delivery.id);
        if (!current) return true;
        const exhausted = current.attempt_number >= (sub.retry_count_max || DEFAULT_ATTEMPTS);
        const wait = BACKOFF_MS[Math.min(current.attempt_number - 1, BACKOFF_MS.length - 1)];
        const jitter = crypto.randomInt(0, Math.max(1, Math.floor(wait / 5)));
        db.updateWebhookDelivery(delivery.id, {
          status: ok ? "DELIVERED" : exhausted ? "DEAD_LETTERED" : "RETRY_SCHEDULED",
          http_status: status,
          duration_ms: duration,
          signature: signed["X-CommerceOS-Signature"],
          delivered_at: at,
          last_error: error,
          claimed_until: undefined,
          next_attempt_at: ok || exhausted ? undefined : new Date(Date.now() + wait + jitter).toISOString(),
        });
        const fresh = db.findEnterpriseWebhook(orgId, sub.id);
        if (!fresh) return true;
        const failures = ok ? 0 : fresh.failed_consecutive_deliveries + 1;
        const pause = !ok && failures >= PAUSE_AFTER_CONSECUTIVE_FAILURES && fresh.status === "ACTIVE";
        if (failures !== fresh.failed_consecutive_deliveries || pause) {
          db.updateEnterpriseWebhook(orgId, sub.id, {
            failed_consecutive_deliveries: failures,
            ...(pause ? { status: "PAUSED" as const, paused_reason: `${failures} deliveries in a row failed (last: ${error})` } : {}),
          });
        }
        if (pause) logger.warn("webhooks.subscription_paused", { organization_id: orgId, subscription_id: sub.id, failures });
        return true;
      },
      () => true
    );
    if (!ok) logger.info("webhooks.delivery_failed", { organization_id: orgId, delivery_id: delivery.id, attempt: delivery.attempt_number, reason: error });
    return ok;
  }

  /** One worker pass: queue new events, then send what is due (at most `limit`). */
  public async runOnce(options: { now?: Date; limit?: number } = {}): Promise<WebhookRunSummary> {
    const now = options.now ?? new Date();
    const summary: WebhookRunSummary = { queued: 0, attempted: 0, delivered: 0, failed: 0 };
    summary.queued = await db.unit(async () => this.enqueueFromEvents(), () => true).catch((err: unknown) => {
      if (isAppError(err) && err.statusCode === 409) return 0; // another server queued them first
      throw err;
    });
    for (const due of db.getDueWebhookDeliveries(now.toISOString(), options.limit ?? 20)) {
      const claimed = await this.claim(due.id, now);
      if (!claimed) continue;
      summary.attempted++;
      if (await this.send(claimed)) summary.delivered++;
      else summary.failed++;
    }
    return summary;
  }

  // ---- Management (organization-scoped; callers resolve the organization from the session) ------------------------

  public listDeliveries(orgId: string, subscriptionId: string, limit = 50): Array<Omit<WebhookDeliveryRecord, "payload_json" | "signature">> {
    if (!db.findEnterpriseWebhook(orgId, subscriptionId)) throw new NotFoundError("Webhook subscription", subscriptionId);
    return db
      .getWebhookDeliveries(subscriptionId)
      .slice(-Math.min(Math.max(limit, 1), 200))
      .reverse()
      .map(({ payload_json: _p, signature: _s, ...rest }) => rest);
  }

  /** A dead-lettered (or failed) delivery gets a fresh round of attempts. */
  public retryDelivery(orgId: string, deliveryId: string): WebhookDeliveryRecord {
    const d = db.findWebhookDelivery(deliveryId);
    if (!d || !db.findEnterpriseWebhook(orgId, d.subscription_id)) throw new NotFoundError("Webhook delivery", deliveryId);
    if (d.status !== "DEAD_LETTERED" && d.status !== "FAILED") throw new BadRequestError(`Only dead-lettered deliveries can be retried (this one is ${d.status}).`);
    return db.updateWebhookDelivery(d.id, { status: "PENDING", attempt_number: 0, next_attempt_at: new Date().toISOString(), last_error: undefined });
  }

  public resumeSubscription(orgId: string, subscriptionId: string): EnterpriseWebhookSubscription {
    const sub = db.findEnterpriseWebhook(orgId, subscriptionId);
    if (!sub) throw new NotFoundError("Webhook subscription", subscriptionId);
    if (sub.status !== "PAUSED") throw new BadRequestError("Only a paused subscription can be resumed.");
    return db.updateEnterpriseWebhook(orgId, subscriptionId, { status: "ACTIVE", failed_consecutive_deliveries: 0, paused_reason: undefined });
  }
}

export const webhookPlatformService = new WebhookPlatformService();
