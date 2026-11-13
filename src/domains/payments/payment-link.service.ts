/**
 * Payment links (ADR-123): a shop sends its customer a link to pay (part of) one order.
 *
 * Staff side (session + RBAC): create, list, cancel.
 * Customer side (no session): the link's token is the only credential. It names the tenant and the order server-side;
 * the public page shows the shop, the order number and the amount, never the customer's name, phone or address.
 *   - Manual: the customer sends money to the shop's number and submits the transaction id. That records a PENDING
 *     payment; it becomes PAID only when staff verify it (PaymentService.verifyPayment). A customer's claim is not proof.
 *   - Online: the customer goes to the shop's own gateway account; GatewayPaymentService settles it after the gateway
 *     confirms the amount to our server.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateSecureToken } from "@/lib/security";
import { newId, randomSuffix } from "@/lib/ids";
import { appBaseUrl } from "@/lib/app-url";
import { loadOrderRows, loadTenantRowsWhere } from "@/infrastructure/db/tenant-rows";
import type { Order, Payment } from "@/types/commerce";
import type { GatewayProvider, ManualPaymentAccounts, PaymentLinkRecord } from "@/types/payments";
import { storeGateways } from "./gateways/gateway-accounts";
import { LINK_TOKEN_PATTERN } from "./gateways/gateway.types";

const HOUR_MS = 60 * 60 * 1000;
export const PAYMENT_LINK_DEFAULT_HOURS = 72;
export const PAYMENT_LINK_MAX_HOURS = 30 * 24;
/** Unverified transaction ids one link accepts: enough for a typo or two, not for flooding the shop's queue. */
export const PAYMENT_LINK_MAX_PENDING = 3;
/**
 * Transaction ids one link accepts over its whole life, rejected ones included: bounds guessing ids against a link
 * (and the bKash lookups that causes, ADR-124). A customer who needs more asks the shop for a new link.
 */
export const PAYMENT_LINK_MAX_SUBMISSIONS = 5;

export const UNPAYABLE_ORDER_STATUSES = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);
const LINK_TENANT_STATUSES = new Set(["ACTIVE", "TRIAL", "PAST_DUE"]);

export const PaymentLinkCreateSchema = z
  .object({
    order_id: z.string().trim().min(1).max(100).optional(),
    order_number: z.string().trim().min(1).max(60).optional(),
    /** Left out: everything still due on the order. */
    amount: z.number().positive().max(10_000_000).optional(),
    note: z.string().trim().max(140).optional(),
    expires_in_hours: z.number().int().min(1).max(PAYMENT_LINK_MAX_HOURS).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.order_id) !== Boolean(v.order_number), { message: "Give either order_id or order_number." });

export type ManualMethod = "BKASH" | "NAGAD" | "ROCKET";

export const ManualSubmissionSchema = z
  .object({
    method: z.enum(["BKASH", "NAGAD", "ROCKET"]),
    transaction_id: z.string().trim().min(6).max(32),
    /** bKash: last 4 digits of the paying number, so a TrxID is tied to its payer (ADR-124). */
    sender_last4: z.string().trim().regex(/^\d{4}$/, "Enter the last 4 digits of the number you paid from.").optional(),
  })
  .strict();

export interface PaymentLinkView extends Omit<PaymentLinkRecord, "token"> {
  /** `/pay/<token>`: the path to share. */
  path: string;
  /** The full URL when APP_URL is configured, else null (the page builds it from its own origin). */
  url: string | null;
  expired: boolean;
}

export interface PublicPaymentLinkView {
  shop_name: string;
  order_number: string;
  amount: number;
  currency: "BDT";
  note: string | null;
  status: "ACTIVE" | "PAID" | "CANCELLED" | "EXPIRED";
  expires_at: string;
  /** A transaction id was submitted and the shop has not checked it yet. */
  awaiting_verification: boolean;
  /** False once the link holds as many waiting or submitted ids as it accepts: the page hides the form. */
  can_submit_transaction_id: boolean;
  methods: {
    manual: ManualPaymentAccounts;
    gateways: GatewayProvider[];
  };
}

/** Marks a manual payment row as coming from a link, so verifying it can close the link. */
export function linkIdempotencyKey(linkId: string, method: string, trx: string): string {
  return `paylink:${linkId}:${method}:${trx}`;
}

export function linkIdFromPayment(payment: Pick<Payment, "idempotency_key">): string | null {
  const match = /^paylink:([^:]+):/.exec(payment.idempotency_key ?? "");
  return match ? match[1] : null;
}

/** The customer-submitted payments of one link (any status). Gateway payments are keyed differently and not counted. */
function linkSubmissions(link: PaymentLinkRecord): Payment[] {
  return db.getPayments(link.tenant_id, link.order_id).filter((p) => linkIdFromPayment(p) === link.id);
}

function isExpired(link: PaymentLinkRecord, now = Date.now()): boolean {
  return link.status === "ACTIVE" && Date.parse(link.expires_at) <= now;
}

function staffView(link: PaymentLinkRecord): PaymentLinkView {
  const { token, ...rest } = link;
  const path = `/pay/${token}`;
  const base = appBaseUrl();
  return { ...rest, path, url: base ? `${base}${path}` : null, expired: isExpired(link) };
}

/** What is still unpaid on an order: its total minus verified payments. */
export function amountDue(tenantId: string, order: Pick<Order, "id" | "grand_total">): number {
  const paid = db
    .getPayments(tenantId, order.id)
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);
  return Math.round((order.grand_total - paid) * 100) / 100;
}

/**
 * What staff type for an order: the number as stored, or copied with the "Order " the Orders drawer puts in front of
 * it, a leading "#", or in lower case. The exact text is tried first, so an imported number is never rewritten away.
 */
export function orderNumberCandidates(raw: string): string[] {
  const exact = raw.trim();
  const stripped = exact.replace(/^order\s*(?:no\.?|number)?\s*[:#]?\s*/i, "").replace(/^#\s*/, "").trim();
  return [...new Set([exact, stripped, stripped.toUpperCase()].filter((v) => v.length > 0))];
}

export class PaymentLinkService {
  public static async create(context: RequestContext, input: z.infer<typeof PaymentLinkCreateSchema>): Promise<PaymentLinkView> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_WRITE);
    const tenantId = context.tenant.id;

    let orderId = input.order_id;
    if (!orderId && input.order_number) {
      const candidates = orderNumberCandidates(input.order_number);
      const rows = await loadTenantRowsWhere(tenantId, "orders", { field: "order_number", values: candidates });
      // Prefer the exact text, then the cleaned-up forms, in that order
      const match = candidates.map((c) => rows.find((r) => r.order_number === c)).find(Boolean);
      orderId = typeof match?.id === "string" ? match.id : undefined;
      if (!orderId) throw new NotFoundError("Order", candidates[candidates.length - 1] ?? input.order_number);
    }
    await loadOrderRows(tenantId, [orderId!]);
    const order = db.findOrderById(tenantId, orderId!);
    if (!order) throw new NotFoundError("Order", orderId);
    if (UNPAYABLE_ORDER_STATUSES.has(order.status)) {
      throw new ConflictError(`A ${order.status.toLowerCase()} order can't take a payment.`);
    }

    const due = amountDue(tenantId, order);
    if (due <= 0) throw new ConflictError("This order is already fully paid.");
    const amount = Math.round((input.amount ?? due) * 100) / 100;
    if (amount > due + 0.5) {
      throw new ValidationError("The amount can't be more than what is still due on the order.", { amount, due });
    }

    const now = new Date();
    const link: PaymentLinkRecord = {
      id: newId("plink"),
      tenant_id: tenantId,
      order_id: order.id,
      order_number: order.order_number,
      token: generateSecureToken(43),
      amount,
      currency: "BDT",
      ...(input.note ? { note: input.note } : {}),
      status: "ACTIVE",
      expires_at: new Date(now.getTime() + (input.expires_in_hours ?? PAYMENT_LINK_DEFAULT_HOURS) * HOUR_MS).toISOString(),
      created_by: context.user.id,
      created_at: now.toISOString(),
    };
    db.savePaymentLink(link);
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: tenantId,
      actor_user_id: context.user.id,
      action: "PAYMENT_LINK_CREATED",
      resource_type: "payment_link",
      resource_id: link.id,
      metadata: { order_id: order.id, order_number: order.order_number, amount, expires_at: link.expires_at },
      created_at: now.toISOString(),
    });
    return staffView(link);
  }

  public static list(context: RequestContext, orderId?: string): PaymentLinkView[] {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_READ);
    return db.getPaymentLinks(context.tenant.id, orderId).map(staffView);
  }

  public static cancel(context: RequestContext, linkId: string): PaymentLinkView {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_WRITE);
    const link = db.findPaymentLinkById(context.tenant.id, linkId);
    if (!link) throw new NotFoundError("Payment link", linkId);
    if (link.status === "PAID") throw new ConflictError("A paid link can't be cancelled.");
    if (link.status === "CANCELLED") return staffView(link);
    const cancelled: PaymentLinkRecord = { ...link, status: "CANCELLED" };
    db.savePaymentLink(cancelled);
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PAYMENT_LINK_CANCELLED",
      resource_type: "payment_link",
      resource_id: link.id,
      metadata: { order_id: link.order_id, amount: link.amount },
      created_at: new Date().toISOString(),
    });
    return staffView(cancelled);
  }

  // ---- Customer side: the token is the credential ----------------------------------------------------------------

  /** The link this token names, when its shop can take payments. Unknown tokens and closed shops look the same. */
  /** Whether this could be a link token at all; routes check it before building a rate-limit key from it. */
  public static assertTokenShape(token: string): void {
    if (!LINK_TOKEN_PATTERN.test(token)) throw new NotFoundError("This payment link is not valid.");
  }

  public static resolve(token: string): PaymentLinkRecord {
    const link = LINK_TOKEN_PATTERN.test(token) ? db.findPaymentLinkByToken(token) : undefined;
    const tenant = link ? db.findTenantById(link.tenant_id) : undefined;
    if (!link || !tenant || !LINK_TENANT_STATUSES.has(tenant.status)) throw new NotFoundError("This payment link is not valid.");
    return link;
  }

  /** A link that can still take a payment, or the reason it can't. */
  public static resolvePayable(token: string): PaymentLinkRecord {
    const link = this.resolve(token);
    if (link.status === "PAID") throw new ConflictError("This payment link has already been paid.");
    if (link.status === "CANCELLED") throw new ConflictError("This payment link was cancelled by the shop.");
    if (isExpired(link)) throw new ConflictError("This payment link has expired. Ask the shop for a new one.");
    return link;
  }

  public static publicView(token: string): PublicPaymentLinkView {
    const link = this.resolve(token);
    const tenant = db.findTenantById(link.tenant_id)!;
    const settings = db.getTenantPaymentSettings(link.tenant_id);
    const submissions = linkSubmissions(link);
    const awaiting = submissions.some((p) => p.status === "PENDING");
    return {
      shop_name: tenant.name,
      order_number: link.order_number,
      amount: link.amount,
      currency: link.currency,
      note: link.note ?? null,
      status: isExpired(link) ? "EXPIRED" : link.status,
      expires_at: link.expires_at,
      awaiting_verification: awaiting,
      can_submit_transaction_id:
        submissions.filter((p) => p.status === "PENDING").length < PAYMENT_LINK_MAX_PENDING && submissions.length < PAYMENT_LINK_MAX_SUBMISSIONS,
      methods: { manual: settings?.manual ?? {}, gateways: storeGateways(link.tenant_id) },
    };
  }

  /**
   * Every refusal a submission can get from what is already in memory, without the store lock or a write: the public
   * route runs this first, so flooding a link (or a shop) with ids costs reads, not locked units of work. Run again
   * inside the unit by submitManualPayment, so nothing that changed in between slips through.
   * `repeat`: the very same submission was already recorded (answered as accepted, nothing new is stored).
   */
  public static precheckManualSubmission(
    token: string,
    input: z.infer<typeof ManualSubmissionSchema>
  ): { link: PaymentLinkRecord; trx: string; key: string; repeat: boolean } {
    const link = this.resolvePayable(token);
    const tenantId = link.tenant_id;
    const manual = db.getTenantPaymentSettings(tenantId)?.manual ?? {};
    const configured = { BKASH: manual.bkash_number, NAGAD: manual.nagad_number, ROCKET: manual.rocket_number }[input.method];
    if (!configured) throw new ValidationError("This shop does not take payments by that method.");

    const trx = input.transaction_id.toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(trx)) throw new ValidationError("The transaction ID should be 6 to 32 letters or digits.");

    const key = linkIdempotencyKey(link.id, input.method, trx);
    if (db.findPaymentByIdempotency(tenantId, key)) return { link, trx, key, repeat: true };
    if (db.findPaymentByTransactionId(tenantId, input.method, trx)) {
      throw new ConflictError("This transaction ID has already been used.");
    }
    const submissions = linkSubmissions(link);
    if (submissions.filter((p) => p.status === "PENDING").length >= PAYMENT_LINK_MAX_PENDING) {
      throw new ConflictError("The shop is already checking a payment for this link. Please wait for them to confirm it.");
    }
    if (submissions.length >= PAYMENT_LINK_MAX_SUBMISSIONS) {
      throw new ConflictError("This link can't take more transaction IDs. Contact the shop, or ask them for a new link.");
    }
    return { link, trx, key, repeat: false };
  }

  /**
   * The customer says they sent the money and gives the transaction id. Recorded as a PENDING payment for staff to
   * verify; nothing is marked paid here.
   */
  public static async submitManualPayment(
    token: string,
    input: z.infer<typeof ManualSubmissionSchema>
  ): Promise<{ status: "PENDING_VERIFICATION"; /** Server-side only: the new row, for the bKash lookup (ADR-124). */ created?: Payment }> {
    // The same checks again, now inside the unit of work
    const { link, trx, key, repeat } = this.precheckManualSubmission(token, input);
    if (repeat) return { status: "PENDING_VERIFICATION" }; // the same submission again
    const tenantId = link.tenant_id;

    await loadOrderRows(tenantId, [link.order_id]);
    const order = db.findOrderById(tenantId, link.order_id);
    if (!order || UNPAYABLE_ORDER_STATUSES.has(order.status)) throw new ConflictError("This order can no longer take a payment.");
    if (amountDue(tenantId, order) <= 0) throw new ConflictError("This order is already fully paid.");

    const now = new Date().toISOString();
    const payment: Payment = {
      id: `pay_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      order_id: link.order_id,
      provider: input.method,
      transaction_id: trx,
      amount: link.amount,
      currency: "BDT",
      status: "PENDING",
      idempotency_key: key,
      ...(input.method === "BKASH" && input.sender_last4 ? { payer_last4: input.sender_last4 } : {}),
      created_at: now,
    };
    db.createPayment(payment);
    db.recordEvent({
      id: `evt_${Date.now()}_payment_submitted_${randomSuffix()}`,
      type: "payment.created",
      version: "1.0",
      tenant_id: tenantId,
      aggregate_type: "payment",
      aggregate_id: payment.id,
      actor_id: "customer:payment_link",
      correlation_id: link.order_number,
      timestamp: now,
      payload: { order_id: link.order_id, amount: link.amount, provider: input.method, payment_link_id: link.id, unverified: true },
    });
    return { status: "PENDING_VERIFICATION", created: payment };
  }

  /** Closes the link a now-verified payment came from (called when staff verify a manual payment, or a gateway settles). */
  public static markPaidByPayment(payment: Payment, linkId = linkIdFromPayment(payment)): void {
    if (!linkId) return;
    const link = db.findPaymentLinkById(payment.tenant_id, linkId);
    if (!link || link.status === "PAID") return;
    db.savePaymentLink({ ...link, status: "PAID", paid_at: new Date().toISOString(), payment_id: payment.id });
  }
}
