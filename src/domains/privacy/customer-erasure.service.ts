/**
 * Customer erasure (FX-83, audit F25): `POST /api/v1/customers/[id]/erase`, workspace owner with a fresh step-up, a
 * typed confirmation and a reason.
 *
 * 1. Direct records: the customer becomes an anonymous shell (so order totals still add up); addresses and channel
 *    identities are deleted; the customer's conversations keep their shape but every message text, draft, agent
 *    reply, tool payload and quote detail is removed; records derived from the person (memory, lifecycle, audiences,
 *    abandoned carts, intelligence, summaries, traces, attachments) are deleted. Orders keep amounts, items and status;
 *    names, phones and street lines in their snapshots go.
 * 2. Copies: an allow-list of free-text collections (events, outbox, webhook and automation logs, support tickets,
 *    leads, analytics events…) is swept for the customer's phone numbers and email, as whole tokens only, replacing
 *    just the matched text. Their full name is swept only in records that belong to them (their conversations, leads,
 *    tickets), so another customer with the same name keeps theirs. Catalog, knowledge, credentials, platform records and anything encrypted or
 *    hashed are never touched.
 * One workspace audit entry records who, which customer id, why, and what was changed (collection names and counts).
 * The suppression list is kept: a "do not contact" entry must outlive the person's other data.
 */
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { logger } from "@/lib/logger";

export const ERASED = "[erased]";

/** Free-text collections a copy of the customer's details can end up in. Nothing else is swept. */
export const SCRUB_COLLECTIONS = [
  "events", "domain_events", "outbound_webhook_deliveries", "webhook_deliveries", "automation_executions", "automation_execution_steps",
  "automation_dead_letters", "automation_audit_logs", "automation_webhook_deliveries", "support_tickets", "leads", "analytics_events",
  "approval_requests", "action_receipts", "ai_feedback", "messages", "conversations", "agent_runs", "agent_tool_calls", "audit_logs",
] as const;

/** Records about the person (by customer_id) that have no use without them. */
const DELETE_BY_CUSTOMER = [
  "customer_memories", "customer_intelligence", "customer_lifecycles", "customer_lifecycle_transitions", "audience_members",
  "abandoned_carts", "enterprise_customer_identities", "communication_preferences",
] as const;
/** Records about the person's conversations (by conversation_id). */
const DELETE_BY_CONVERSATION = ["conversation_summaries", "ai_traces", "attachments", "chat_sessions", "agent_jobs"] as const;

/** Keys never rewritten by the sweep: identifiers, secrets, hashes. */
const PROTECTED_KEY = /(^id$|_id$|_ids$|encrypted|hash|secret|token|signature)/i;

export interface ErasureResult {
  customer_id: string;
  conversations: number;
  messages: number;
  identities: number;
  orders_redacted: number;
  deleted: Record<string, number>;
  scrubbed: Record<string, number>;
}

const BN = "০১২৩৪৫৬৭৮৯";
const toBangla = (s: string) => s.replace(/\d/g, (d) => BN[Number(d)]);
const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Bangladeshi mobile number's common written forms, in ASCII and Bangla digits. Anything else: none. */
function phoneForms(phone: string | undefined): string[] {
  const digits = toAscii(phone ?? "").replace(/\D/g, "");
  const local = digits.length >= 10 ? `0${digits.slice(-10)}` : "";
  if (!/^01[3-9]\d{8}$/.test(local)) return [];
  const forms = [local, `+88${local}`, `88${local}`, local.slice(1), `${local.slice(0, 5)}-${local.slice(5)}`, `${local.slice(0, 5)} ${local.slice(5)}`];
  return [...forms, ...forms.map(toBangla)];
}

/** A name worth sweeping for: two words or more (a single first name would match other people and words). */
const sweepableName = (name: string | undefined) => (name && name.trim().split(/\s+/).length >= 2 && name.trim().length >= 5 ? name.trim() : undefined);

export class CustomerErasureService {
  public static erase(context: RequestContext, customerId: string, reason: string): ErasureResult {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_ERASE);
    const tenantId = context.tenant.id;
    const data = db.data as unknown as Record<string, Array<Record<string, unknown>>>;
    const customer = db.data.customers.find((c) => c.tenant_id === tenantId && c.id === customerId);
    if (!customer) throw new NotFoundError(`Customer '${customerId}' not found.`);

    const identities = db.data.customer_identities.filter((i) => i.tenant_id === tenantId && i.customer_id === customerId);
    const addresses = db.data.customer_addresses.filter((a) => a.tenant_id === tenantId && a.customer_id === customerId);
    const phones = new Set<string>();
    for (const p of [customer.phone, ...addresses.map((a) => a.phone), ...identities.flatMap((i) => [i.phone, i.channel_type === "WHATSAPP" ? i.external_user_id : undefined])]) {
      for (const f of phoneForms(p)) phones.add(f);
    }
    const emails = new Set<string>();
    for (const e of [customer.email, ...identities.map((i) => i.email)]) if (e && e.includes("@")) emails.add(e);
    const names = new Set<string>();
    for (const n of [`${customer.first_name ?? ""} ${customer.last_name ?? ""}`, ...identities.map((i) => i.display_name)]) {
      const name = sweepableName(n);
      if (name) names.add(name);
    }

    const conversationIds = new Set(db.data.conversations.filter((c) => c.tenant_id === tenantId && c.customer_id === customerId).map((c) => c.id));
    const result: ErasureResult = { customer_id: customerId, conversations: conversationIds.size, messages: 0, identities: identities.length, orders_redacted: 0, deleted: {}, scrubbed: {} };
    const inChat = (r: Record<string, unknown>) => typeof r.conversation_id === "string" && conversationIds.has(r.conversation_id);

    // 1. Direct records
    for (const m of db.data.messages) {
      if (m.tenant_id !== tenantId || !conversationIds.has(m.conversation_id)) continue;
      m.text = ERASED;
      m.metadata = {};
      delete (m as { attachments?: unknown }).attachments;
      result.messages++;
    }
    for (const c of db.data.conversations) {
      if (c.tenant_id !== tenantId || !conversationIds.has(c.id)) continue;
      c.metadata = {};
      delete c.subject;
      delete c.referral_metadata;
      delete c.source_url;
    }
    const runIds = new Set<string>();
    for (const r of db.data.agent_runs) {
      if (r.tenant_id !== tenantId || !r.conversation_id || !conversationIds.has(r.conversation_id)) continue;
      runIds.add(r.id);
      r.final_response = ERASED;
      r.metadata = { erased: true };
    }
    for (const t of db.data.agent_tool_calls) {
      if (t.tenant_id !== tenantId || !(runIds.has(t.agent_run_id) || conversationIds.has(t.conversation_id))) continue;
      t.input_arguments = {};
      delete t.sanitized_result;
      delete t.error_message;
    }
    for (const q of db.data.quotes) if (q.tenant_id === tenantId && conversationIds.has(q.conversation_id)) delete q.confirmation_details;
    for (const l of db.data.leads) if (l.tenant_id === tenantId && l.customer_id === customerId) delete l.notes;
    for (const o of db.data.orders) {
      if (o.tenant_id !== tenantId || o.customer_id !== customerId) continue;
      const strip = (a: Record<string, unknown> | undefined) => (a ? { district: a.district, division: a.division, area: a.area, upazila: a.upazila, country: a.country } : a);
      o.shipping_address_snapshot = strip(o.shipping_address_snapshot as Record<string, unknown>) as typeof o.shipping_address_snapshot;
      if (o.billing_address_snapshot) o.billing_address_snapshot = strip(o.billing_address_snapshot as Record<string, unknown>) as typeof o.billing_address_snapshot;
      delete o.notes;
      result.orders_redacted++;
    }
    const remove = (collection: string, match: (r: Record<string, unknown>) => boolean) => {
      const rows = data[collection];
      if (!Array.isArray(rows)) return;
      const kept = rows.filter((r) => !(r.tenant_id === tenantId && match(r)));
      if (kept.length !== rows.length) {
        result.deleted[collection] = rows.length - kept.length;
        data[collection] = kept;
      }
    };
    remove("customer_identities", (r) => r.customer_id === customerId);
    remove("customer_addresses", (r) => r.customer_id === customerId);
    for (const c of DELETE_BY_CUSTOMER) remove(c, (r) => r.customer_id === customerId);
    for (const c of DELETE_BY_CONVERSATION) remove(c, inChat);
    Object.assign(customer, { first_name: "Erased", last_name: "customer", phone: "", notes: undefined, addresses: [], updated_at: new Date().toISOString() });
    delete customer.email;

    // 2. Copies in free-text collections: whole tokens only, only the matched text replaced. Phones and emails are
    //    swept everywhere; the name only in records that belong to this customer (another "Md Rahim" keeps theirs).
    const alternation = (list: Set<string>) => [...list].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    const everywhere: RegExp[] = [];
    if (phones.size) everywhere.push(new RegExp(`(?<![\\p{N}])(?:${alternation(phones)})(?![\\p{N}])`, "gu"));
    if (emails.size) everywhere.push(new RegExp(`(?<![\\p{L}\\p{N}_.])(?:${alternation(emails)})(?![\\p{L}\\p{N}_])`, "giu"));
    const ownOnly = names.size ? [new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation(names)})(?![\\p{L}\\p{N}_])`, "giu")] : [];
    // Records about this customer: their own rows, rows about their orders or chats (events, audit entries, outbox)
    const ownIds = new Set<string>([customerId, ...conversationIds, ...db.data.orders.filter((o) => o.tenant_id === tenantId && o.customer_id === customerId).map((o) => o.id)]);
    const refersToThem = (v: unknown) => typeof v === "string" && ownIds.has(v);
    const theirs = (r: Record<string, unknown>) => {
      const payload = (r.payload ?? r.metadata ?? {}) as Record<string, unknown>;
      return [r.customer_id, r.conversation_id, r.resource_id, r.aggregate_id, r.order_id, r.id, payload.customer_id, payload.order_id, payload.conversation_id].some(refersToThem);
    };
    for (const collection of SCRUB_COLLECTIONS) {
      const n = this.scrubCollection(data[collection], tenantId, (r) => (theirs(r) ? [...everywhere, ...ownOnly] : everywhere));
      if (n) result.scrubbed[collection] = n;
    }

    db.createAuditLog({
      id: `aud_erase_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: context.user.id,
      action: "CUSTOMER_ERASED",
      resource_type: "customer",
      resource_id: customerId,
      metadata: {
        reason,
        step_up: Boolean(context.stepUpVerified),
        conversations: result.conversations,
        messages: result.messages,
        orders_redacted: result.orders_redacted,
        deleted: result.deleted,
        scrubbed: result.scrubbed,
      },
      created_at: new Date().toISOString(),
    });
    db.markDirty();
    logger.info("privacy.customer_erased", { tenant_id: tenantId, customer_id: customerId, actor: context.user.id });
    return result;
  }

  /** Replaces matched spans in this workspace's records of one collection. Returns how many records changed. */
  private static scrubCollection(rows: Array<Record<string, unknown>> | undefined, tenantId: string, patternsFor: (r: Record<string, unknown>) => RegExp[]): number {
    if (!Array.isArray(rows)) return 0;
    let patterns: RegExp[] = [];
    const fix = (s: string): string => patterns.reduce((acc, re) => acc.replace(re, ERASED), s);
    const walk = (v: unknown): { value: unknown; hit: boolean } => {
      if (typeof v === "string") {
        const out = fix(v);
        return { value: out, hit: out !== v };
      }
      if (Array.isArray(v)) {
        let hit = false;
        const value = v.map((x) => {
          const r = walk(x);
          hit ||= r.hit;
          return r.value;
        });
        return { value, hit };
      }
      if (v && typeof v === "object") {
        let hit = false;
        const obj = v as Record<string, unknown>;
        for (const [k, x] of Object.entries(obj)) {
          if (PROTECTED_KEY.test(k)) continue;
          const r = walk(x);
          if (r.hit) {
            obj[k] = r.value;
            hit = true;
          }
        }
        return { value: v, hit };
      }
      return { value: v, hit: false };
    };
    let changed = 0;
    for (const record of rows) {
      if (!record || record.tenant_id !== tenantId) continue;
      patterns = patternsFor(record);
      if (patterns.length && walk(record).hit) changed++;
    }
    return changed;
  }
}
