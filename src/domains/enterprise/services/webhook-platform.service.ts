import crypto from "crypto";
import { randomSuffix } from "@/lib/ids";
/**
 * Enterprise outbound webhooks, delivered for real (FIX_IMPLEMENTATION_PLAN FX-54, ADR-110).
 *
 * - Subscribe: the target is a tenant-chosen URL, so it must be https on a standard port and must not resolve to a
 *   private, loopback or link-local address (the platform allow-list never applies). The check runs outside the store
 *   lock (prepareTarget), the save inside a short unit (createSubscription). The signing secret is shown once and
 *   stored encrypted. At most 25 subscriptions per organization.
 * - Outbox: the workspace's commerce events (everything recorded through db.recordEvent) are queued per matching
 *   subscription, one delivery per (subscription, event): the delivery id is derived from both, so two servers queuing
 *   the same event produce one delivery.
 * - Delivery: POST of a JSON envelope, signed (X-CommerceOS-Signature over "<timestamp>.<body>", see
 *   src/lib/outbound-signing.ts), 10 s deadline, no redirects. 2xx = DELIVERED. Otherwise retried with backoff
 *   (~30 s, 2 min, 10 min, 1 h, 6 h) up to the subscription's retry_count_max, then DEAD_LETTERED (retry by hand).
 *   20 failed deliveries in a row pause the subscription (resume by hand). A suspended or kill-switched workspace or an
 *   inactive organization sends nothing. Each pass sends at most 5 deliveries per organization, 4 at a time.
 * - Several servers: a delivery is claimed in a unit of work before it is sent (ADR-109), so only one server sends
 *   it; a claim expires after 60 s if that server stops. Delivery is at-least-once: receivers dedupe on
 *   X-CommerceOS-Event-Id. Finished deliveries are removed after 30 days.
 */
import { db, type TenantRecord } from "@/infrastructure/db";
import { BadRequestError, NotFoundError, PlanLimitError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertSafeUrl, outboundRequest } from "@/lib/outbound-http";
import { signOutbound } from "@/lib/outbound-signing";
import { decryptCredential, encryptCredential } from "@/lib/security";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { EnterpriseWebhookSubscription, WebhookDeliveryRecord } from "@/types/enterprise";
import type { CommerceEvent } from "@/types/commerce";

const DELIVERY_TIMEOUT_MS = 10_000;
const CLAIM_MS = 60_000;
const PAUSE_AFTER_CONSECUTIVE_FAILURES = 20;
const DEFAULT_ATTEMPTS = 6;
const MAX_SUBSCRIPTIONS_PER_ORG = 25;
/** Delay before attempt n+1 (after attempt n failed), before jitter. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** Events are re-scanned from a little before the saved position: an event another server recorded can arrive late. */
const OUTBOX_OVERLAP_MS = 120_000;
/** New deliveries queued per subscription and pass; the rest follow on the next pass. */
const OUTBOX_QUEUE_PER_PASS = 1_000;
const PER_ORG_PER_PASS = 5;
const SEND_CONCURRENCY = 4;
const RETENTION_MS = 30 * 24 * 3_600_000;
const PRUNE_EVERY_MS = 3_600_000;
const SENDING_TENANT_STATUSES = new Set<TenantRecord["status"]>(["ACTIVE", "TRIAL", "PAST_DUE"]);

export interface WebhookRunSummary {
  queued: number;
  attempted: number;
  delivered: number;
  failed: number;
}

/** Who made a management change (for the workspace audit log). */
export interface WebhookActor {
  tenantId: string;
  userId: string;
}

function deliveryIdFor(subscriptionId: string, eventId: string): string {
  return `whd_${crypto.createHash("sha256").update(`${subscriptionId}|${eventId}`).digest("hex").slice(0, 32)}`;
}

function matches(sub: EnterpriseWebhookSubscription, eventType: string): boolean {
  return sub.event_types.includes("*") || sub.event_types.includes(eventType);
}

/** The HMAC key: stored encrypted; subscriptions from before encryption hold the plain `whsec_` value. */
function signingSecret(sub: EnterpriseWebhookSubscription): string {
  return sub.secret.startsWith("whsec_") ? sub.secret : decryptCredential<{ secret: string }>(sub.secret).secret;
}

function audit(actor: WebhookActor | undefined, action: string, resourceId: string, metadata: Record<string, unknown>): void {
  if (!actor) return;
  db.createAuditLog({
    id: `aud_wh_${randomSuffix()}`,
    tenant_id: actor.tenantId,
    actor_user_id: actor.userId,
    action,
    resource_type: "enterprise_webhook",
    resource_id: resourceId,
    metadata,
    created_at: new Date().toISOString(),
  });
}

export class WebhookPlatformService {
  private lastPruneAt = 0;

  /** Checks a target URL (DNS included). Call it outside any unit of work: it may wait on the network. */
  public async prepareTarget(targetUrl: string): Promise<URL> {
    if (typeof targetUrl !== "string" || !targetUrl.trim()) throw new BadRequestError("A webhook URL is required.");
    return assertSafeUrl(targetUrl.trim(), { tenantSupplied: true });
  }

  /**
   * Saves a subscription for a checked target. Returns it with the signing secret in plain text — the only time it is
   * ever returned.
   */
  public createSubscription(
    orgId: string,
    target: URL,
    params: { eventTypes: string[]; applicationId?: string },
    actor?: WebhookActor
  ): EnterpriseWebhookSubscription {
    const eventTypes = [...new Set(params.eventTypes)].filter((t) => /^(\*|[a-z_]+(\.[a-z_]+)+)$/.test(t));
    if (!eventTypes.length || eventTypes.length !== new Set(params.eventTypes).size) {
      throw new BadRequestError('Event types look like "order.created" (or "*" for every event).');
    }
    const existing = db.getEnterpriseWebhooks(orgId).filter((w) => w.status !== "DISABLED").length;
    if (existing >= MAX_SUBSCRIPTIONS_PER_ORG) throw new PlanLimitError("webhook subscriptions", MAX_SUBSCRIPTIONS_PER_ORG, existing);
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const now = new Date().toISOString();
    const sub: EnterpriseWebhookSubscription = {
      id: `whsub_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      application_id: params.applicationId,
      target_url: target.toString(),
      secret: encryptCredential({ secret }),
      event_types: eventTypes,
      status: "ACTIVE",
      retry_count_max: DEFAULT_ATTEMPTS,
      failed_consecutive_deliveries: 0,
      // Only events from now on are delivered (no backfill of history)
      events_queued_through: now,
      created_at: now,
      updated_at: now,
    };
    db.createEnterpriseWebhook(sub);
    audit(actor, "webhook.subscribed", sub.id, { organization_id: orgId, target_host: target.host, event_types: eventTypes });
    return { ...sub, secret };
  }

  /** prepareTarget + createSubscription, for callers that aren't inside a unit of work. */
  public async subscribe(
    orgId: string,
    params: { targetUrl: string; eventTypes: string[]; applicationId?: string },
    actor?: WebhookActor
  ): Promise<EnterpriseWebhookSubscription> {
    const target = await this.prepareTarget(params.targetUrl);
    return this.createSubscription(orgId, target, params, actor);
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
    const known = new Set(db.getWebhookDeliveries().map((d) => d.id));
    return db
      .getEnterpriseWebhooks(params.organizationId)
      .filter((s) => s.status === "ACTIVE" && matches(s, params.eventType))
      .map((sub) => this.queue(sub, event, known))
      .filter((d): d is WebhookDeliveryRecord => d !== null);
  }

  /** One delivery of `event` to `sub`, unless it exists already (the id is derived from both). */
  private queue(sub: EnterpriseWebhookSubscription, event: CommerceEvent, known: Set<string>): WebhookDeliveryRecord | null {
    const id = deliveryIdFor(sub.id, event.id);
    if (known.has(id)) return null;
    known.add(id);
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

  /** The workspace that owns the organization, if it may send data out now (active, not kill-switched). */
  private sendingTenant(orgId: string): string | null {
    const org = db.findOrganizationById(orgId);
    if (!org?.tenant_id || org.status !== "ACTIVE") return null;
    const tenant = db.findTenantById(org.tenant_id);
    if (!tenant || !SENDING_TENANT_STATUSES.has(tenant.status)) return null;
    if (PlatformSafetyService.isExecutionBlocked("TENANT", tenant.id)) return null;
    return tenant.id;
  }

  /**
   * Outbox: new commerce events of each subscription's workspace become deliveries. One pass over the events for all
   * subscriptions; each subscription's position moves only past events it has handled, so a burst of any size is
   * worked through over several passes and never stalls.
   */
  public enqueueFromEvents(): number {
    const active = db.getAllEnterpriseWebhooks().filter((s) => s.status === "ACTIVE");
    if (!active.length) return 0;
    const byTenant = new Map<string, Array<{ sub: EnterpriseWebhookSubscription; since: string }>>();
    for (const sub of active) {
      const tenantId = this.sendingTenant(sub.organization_id);
      if (!tenantId) continue;
      const position = sub.events_queued_through ?? sub.created_at;
      const since = new Date(Date.parse(position) - OUTBOX_OVERLAP_MS).toISOString();
      const list = byTenant.get(tenantId) ?? [];
      list.push({ sub, since });
      byTenant.set(tenantId, list);
    }
    if (!byTenant.size) return 0;
    const earliest = new Map<string, string>();
    for (const [tenantId, subs] of byTenant) earliest.set(tenantId, subs.reduce((m, s) => (s.since < m ? s.since : m), subs[0].since));
    const eventsByTenant = new Map<string, CommerceEvent[]>();
    for (const e of db.getAllEvents()) {
      const from = earliest.get(e.tenant_id);
      if (from === undefined || e.timestamp < from) continue;
      const list = eventsByTenant.get(e.tenant_id) ?? [];
      list.push(e);
      eventsByTenant.set(e.tenant_id, list);
    }
    const known = new Set(db.getWebhookDeliveries().map((d) => d.id));
    let queued = 0;
    for (const [tenantId, subs] of byTenant) {
      const events = (eventsByTenant.get(tenantId) ?? []).sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : 1));
      for (const { sub, since } of subs) {
        const position = sub.events_queued_through ?? sub.created_at;
        let through = position;
        let queuedHere = 0;
        for (const event of events) {
          if (event.timestamp < since || event.timestamp < sub.created_at) continue;
          if (matches(sub, event.type)) {
            if (queuedHere >= OUTBOX_QUEUE_PER_PASS && !known.has(deliveryIdFor(sub.id, event.id))) break; // the rest next pass
            if (this.queue(sub, event, known)) queuedHere++;
          }
          // Only as far as the newest event handled, never to "now": an event another server recorded (its clock may
          // be a little behind) must still be found by the next pass
          if (event.timestamp > through) through = event.timestamp;
        }
        queued += queuedHere;
        if (through !== sub.events_queued_through) db.updateEnterpriseWebhook(sub.organization_id, sub.id, { events_queued_through: through });
      }
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
          if (!sub || sub.status !== "ACTIVE" || !this.sendingTenant(sub.organization_id)) return null;
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
    const signed = signOutbound(signingSecret(sub), delivery.payload_json);
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
        tenantSupplied: true,
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

  /** One worker pass: queue new events, then send what is due (at most `limit`, fairly across organizations). */
  public async runOnce(options: { now?: Date; limit?: number } = {}): Promise<WebhookRunSummary> {
    const now = options.now ?? new Date();
    const summary: WebhookRunSummary = { queued: 0, attempted: 0, delivered: 0, failed: 0 };
    if (!db.getAllEnterpriseWebhooks().some((s) => s.status === "ACTIVE") && !db.getDueWebhookDeliveries(now.toISOString(), 1).length) return summary;
    summary.queued = await db.unit(async () => this.enqueueFromEvents(), () => true).catch((err: unknown) => {
      if (isAppError(err) && err.statusCode === 409) return 0; // another server queued them first
      throw err;
    });
    if (Date.now() - this.lastPruneAt > PRUNE_EVERY_MS) {
      this.lastPruneAt = Date.now();
      await db.unit(async () => db.pruneWebhookDeliveries(new Date(now.getTime() - RETENTION_MS).toISOString()), () => true).catch(() => 0);
    }
    // Fair share: at most PER_ORG_PER_PASS per organization, so one organization's slow receiver can't hold up others
    const perOrg = new Map<string, number>();
    const batch: WebhookDeliveryRecord[] = [];
    for (const due of db.getDueWebhookDeliveries(now.toISOString(), 1_000)) {
      const org = due.organization_id ?? "";
      const n = perOrg.get(org) ?? 0;
      if (n >= PER_ORG_PER_PASS) continue;
      perOrg.set(org, n + 1);
      batch.push(due);
      if (batch.length >= (options.limit ?? 20)) break;
    }
    for (let i = 0; i < batch.length; i += SEND_CONCURRENCY) {
      await Promise.all(
        batch.slice(i, i + SEND_CONCURRENCY).map(async (due) => {
          const claimed = await this.claim(due.id, now);
          if (!claimed) return;
          summary.attempted++;
          if (await this.send(claimed)) summary.delivered++;
          else summary.failed++;
        })
      );
    }
    return summary;
  }

  // ---- Management (organization-scoped; callers resolve the organization from the session) ------------------------

  public listDeliveries(orgId: string, subscriptionId: string, limit = 50): Array<Omit<WebhookDeliveryRecord, "payload_json" | "signature">> {
    if (!db.findEnterpriseWebhook(orgId, subscriptionId)) throw new NotFoundError("Webhook subscription", subscriptionId);
    return db
      .getWebhookDeliveries(subscriptionId)
      .filter((d) => d.organization_id === undefined || d.organization_id === orgId)
      .slice(-Math.min(Math.max(limit, 1), 200))
      .reverse()
      .map(({ payload_json: _p, signature: _s, ...rest }) => rest);
  }

  /** A dead-lettered (or failed) delivery gets a fresh round of attempts. */
  public retryDelivery(orgId: string, deliveryId: string, actor?: WebhookActor): WebhookDeliveryRecord {
    const d = db.findWebhookDelivery(deliveryId);
    if (!d || d.organization_id !== orgId || !db.findEnterpriseWebhook(orgId, d.subscription_id)) throw new NotFoundError("Webhook delivery", deliveryId);
    if (d.status !== "DEAD_LETTERED" && d.status !== "FAILED") throw new BadRequestError(`Only dead-lettered deliveries can be retried (this one is ${d.status}).`);
    const updated = db.updateWebhookDelivery(d.id, { status: "PENDING", attempt_number: 0, next_attempt_at: new Date().toISOString(), last_error: undefined });
    audit(actor, "webhook.delivery_retried", d.id, { organization_id: orgId, subscription_id: d.subscription_id, event_type: d.event_type });
    return updated;
  }

  public resumeSubscription(orgId: string, subscriptionId: string, actor?: WebhookActor): EnterpriseWebhookSubscription {
    const sub = db.findEnterpriseWebhook(orgId, subscriptionId);
    if (!sub) throw new NotFoundError("Webhook subscription", subscriptionId);
    if (sub.status !== "PAUSED") throw new BadRequestError("Only a paused subscription can be resumed.");
    const resumed = db.updateEnterpriseWebhook(orgId, subscriptionId, { status: "ACTIVE", failed_consecutive_deliveries: 0, paused_reason: undefined });
    audit(actor, "webhook.resumed", sub.id, { organization_id: orgId, paused_reason: sub.paused_reason });
    return resumed;
  }
}

export const webhookPlatformService = new WebhookPlatformService();
