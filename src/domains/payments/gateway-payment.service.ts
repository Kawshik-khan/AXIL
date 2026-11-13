/**
 * Hosted gateway checkout for both money flows (ADR-123):
 *   - STORE: a customer pays a shop's payment link through the shop's own gateway account.
 *   - PLATFORM: a workspace pays its subscription invoice through the platform's gateway account.
 *
 * `start…Checkout` records an attempt and asks the gateway for its hosted page. `complete` runs when the payer's
 * browser comes back or the gateway's server notifies us. What arrives in that request is only a pointer: the attempt
 * is found by our own unguessable id, the gateway is asked with the merchant's credentials, and money is recorded
 * only when its answer names this attempt with the same amount in BDT. Everything else leaves the attempt unpaid.
 *
 * The gateway calls happen outside the store lock; the records are written in short units of work.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { ConflictError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { appBaseUrl } from "@/lib/app-url";
import { newId, randomSuffix } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";
import type { Payment, PaymentMethod } from "@/types/commerce";
import type { GatewayPaymentAttemptRecord, GatewayProvider } from "@/types/payments";
import { BillingService } from "@/domains/billing/billing.service";
import { gatewayAdapter, platformGatewayAccount, sandboxSettles, storeGatewayAccount } from "./gateways/gateway-accounts";
import { ATTEMPT_ID_PATTERN, sameAmount, type GatewayAccount, type GatewayConfirmation, type GatewayReturn } from "./gateways/gateway.types";
import { amountDue, PaymentLinkService } from "./payment-link.service";

/** Checkout attempts one link or invoice may open: bounds what an anonymous link holder can ask of a shop's gateway. */
export const MAX_ATTEMPTS_PER_REFERENCE = 12;
const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** An unpaid attempt is asked about at the gateway for this long (a bKash payment id lives 24 hours), then left alone. */
export const ATTEMPT_CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000;

const recentAttempts = (attempts: GatewayPaymentAttemptRecord[]) => attempts.filter((a) => Date.parse(a.created_at) > Date.now() - ATTEMPT_WINDOW_MS).length;

export interface GatewayOutcome {
  /** TEST: the gateway's sandbox confirmed the payment and nothing was marked paid. */
  status: "PAID" | "FAILED" | "CANCELLED" | "PENDING" | "TEST";
  scope: "STORE" | "PLATFORM";
  /** Where the payer's browser should land: the pay page or the billing page. */
  redirect_path: string;
}

/** SSLCommerz tran_id is at most 30 characters: "gp" + 26 hex (104 random bits). */
function newAttemptId(): string {
  return `gp${crypto.randomBytes(13).toString("hex")}`;
}

function requireAppUrl(): string {
  const base = appBaseUrl();
  if (!base) throw new IntegrationNotConfiguredError("Online checkout", "APP_URL is not set to this app's public https address");
  return base;
}

function paymentMethodFor(provider: GatewayProvider, channel?: string): PaymentMethod {
  if (provider === "BKASH") return "BKASH";
  const name = (channel ?? "").toUpperCase();
  if (name.includes("BKASH")) return "BKASH";
  if (name.includes("NAGAD")) return "NAGAD";
  if (name.includes("ROCKET") || name.includes("DBBL MOBILE") || name.includes("DBBLMOBILE")) return "ROCKET";
  return "CARD";
}

function accountFor(attempt: GatewayPaymentAttemptRecord): GatewayAccount {
  return attempt.scope === "STORE"
    ? storeGatewayAccount(attempt.tenant_id, attempt.provider, { evenIfDisabled: true })
    : platformGatewayAccount(attempt.provider);
}

function outcome(
  attempt: GatewayPaymentAttemptRecord,
  status: GatewayOutcome["status"] = attempt.test_only ? "TEST" : attempt.status === "INITIATED" ? "PENDING" : attempt.status
): GatewayOutcome {
  if (attempt.scope === "PLATFORM") {
    return { status, scope: "PLATFORM", redirect_path: `/settings/billing?invoice=${encodeURIComponent(attempt.reference_id)}&payment=${status.toLowerCase()}` };
  }
  const link = db.findPaymentLinkById(attempt.tenant_id, attempt.reference_id);
  return { status, scope: "STORE", redirect_path: link ? `/pay/${link.token}?payment=${status.toLowerCase()}` : "/" };
}

export class GatewayPaymentService {
  /** A customer with a payment link asks to pay online through the shop's gateway. Returns the gateway's page. */
  public static async startLinkCheckout(token: string, provider: GatewayProvider): Promise<{ redirect_url: string }> {
    const appUrl = requireAppUrl();
    const link = PaymentLinkService.resolvePayable(token);
    const tenantId = link.tenant_id;
    const account = storeGatewayAccount(tenantId, provider);

    const attempt = await db.unit(async () => {
      await loadOrderRows(tenantId, [link.order_id]);
      const order = db.findOrderById(tenantId, link.order_id);
      if (!order || ["CANCELLED", "RETURNED", "REFUNDED"].includes(order.status)) throw new ConflictError("This order can no longer take a payment.");
      if (amountDue(tenantId, order) <= 0) throw new ConflictError("This order is already fully paid.");
      if (recentAttempts(db.getGatewayPaymentAttempts(tenantId, { type: "PAYMENT_LINK", id: link.id })) >= MAX_ATTEMPTS_PER_REFERENCE) {
        throw new ConflictError("Too many payment attempts were started for this link today. Try again tomorrow or ask the shop for a new one.");
      }
      const customer = db.findCustomerById(tenantId, order.customer_id);
      const now = new Date().toISOString();
      const record = db.saveGatewayPaymentAttempt({
        id: newAttemptId(),
        scope: "STORE",
        tenant_id: tenantId,
        provider,
        mode: account.mode,
        reference_type: "PAYMENT_LINK",
        reference_id: link.id,
        amount: link.amount,
        currency: "BDT",
        status: "INITIATED",
        created_at: now,
        updated_at: now,
      });
      return {
        record,
        customer: {
          name: order.customer_name || "Customer",
          phone: order.customer_phone || "",
          // SSLCommerz requires an email; a shop's customers often have none, so the staff member who made the link stands in.
          email: customer?.email || db.findUserById(link.created_by)?.email || "",
          address: order.delivery_address?.address_line_1 || undefined,
          city: order.delivery_address?.district || undefined,
          postcode: order.delivery_address?.postal_code || undefined,
        },
      };
    }, () => true);

    return this.openCheckout(attempt.record, account, {
      description: `Order ${link.order_number}`,
      customer: attempt.customer,
      appBaseUrl: appUrl,
    });
  }

  /** A workspace pays its subscription invoice through the platform's gateway account. */
  public static async startInvoiceCheckout(
    context: RequestContext,
    invoiceId: string,
    input: { provider: GatewayProvider; phone: string }
  ): Promise<{ redirect_url: string }> {
    const appUrl = requireAppUrl();
    const invoice = BillingService.payableInvoice(context, invoiceId);
    const account = platformGatewayAccount(input.provider);
    const tenantId = context.tenant.id;

    const record = await db.unit(async () => {
      if (recentAttempts(db.getGatewayPaymentAttempts(tenantId, { type: "BILLING_INVOICE", id: invoice.id })) >= MAX_ATTEMPTS_PER_REFERENCE) {
        throw new ConflictError("Too many payment attempts were started for this invoice today. Try again tomorrow.");
      }
      const now = new Date().toISOString();
      return db.saveGatewayPaymentAttempt({
        id: newAttemptId(),
        scope: "PLATFORM",
        tenant_id: tenantId,
        provider: input.provider,
        mode: account.mode,
        reference_type: "BILLING_INVOICE",
        reference_id: invoice.id,
        amount: invoice.amount_bdt,
        currency: "BDT",
        status: "INITIATED",
        created_at: now,
        updated_at: now,
      });
    }, () => true);

    return this.openCheckout(record, account, {
      description: `CommerceOS invoice ${invoice.invoice_number}`,
      customer: { name: context.user.name || context.tenant.name, phone: input.phone, email: context.user.email },
      appBaseUrl: appUrl,
    });
  }

  private static async openCheckout(
    attempt: GatewayPaymentAttemptRecord,
    account: GatewayAccount,
    request: { description: string; customer: { name: string; phone: string; email: string; address?: string; city?: string; postcode?: string }; appBaseUrl: string }
  ): Promise<{ redirect_url: string }> {
    try {
      if (attempt.provider === "SSLCOMMERZ" && !request.customer.email) {
        throw new ValidationError("SSLCommerz needs an email address for the payer.");
      }
      const session = await gatewayAdapter(attempt.provider).createCheckout(account, {
        attemptId: attempt.id,
        amount: attempt.amount,
        ...request,
      });
      await db.unit(async () => {
        const current = db.findGatewayPaymentAttempt(attempt.id) ?? attempt;
        db.saveGatewayPaymentAttempt({ ...current, gateway_reference: session.gatewayReference, updated_at: new Date().toISOString() });
      }, () => true);
      return { redirect_url: session.redirectUrl };
    } catch (err) {
      await db
        .unit(async () => {
          const current = db.findGatewayPaymentAttempt(attempt.id) ?? attempt;
          if (current.status !== "INITIATED") return;
          db.saveGatewayPaymentAttempt({
            ...current,
            status: "FAILED",
            failure_reason: "The gateway did not open a checkout.",
            updated_at: new Date().toISOString(),
          });
        }, () => true)
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * The payer came back from the gateway, or the gateway notified us. `returned` is untrusted. Safe to call any
   * number of times: a settled attempt is never settled twice, and a later confirmed payment still settles an attempt
   * an earlier callback had marked cancelled or failed.
   */
  public static async complete(provider: GatewayProvider, attemptId: string, returned: GatewayReturn): Promise<GatewayOutcome> {
    const attempt = ATTEMPT_ID_PATTERN.test(attemptId) ? db.findGatewayPaymentAttempt(attemptId) : undefined;
    if (!attempt || attempt.provider !== provider) throw new NotFoundError("This payment attempt is not known.");
    if (attempt.status === "PAID") return outcome(attempt);
    // An old unpaid attempt is not worth another gateway call, whoever asks (the payer holds its id).
    if (Date.parse(attempt.created_at) < Date.now() - ATTEMPT_CONFIRM_WINDOW_MS) return outcome(attempt);

    const account = accountFor(attempt);
    if (account.mode !== attempt.mode) {
      return this.record(attempt.id, { status: "PENDING", reason: "The gateway settings changed after this payment was started." });
    }
    const confirmation = await gatewayAdapter(provider).confirm(account, { id: attempt.id, gatewayReference: attempt.gateway_reference }, returned);
    return this.record(attempt.id, confirmation);
  }

  /** Where a payer's browser belongs for this attempt when the gateway could not be asked; null for an unknown attempt. */
  public static landing(provider: GatewayProvider, attemptId: string): GatewayOutcome | null {
    const attempt = ATTEMPT_ID_PATTERN.test(attemptId) ? db.findGatewayPaymentAttempt(attemptId) : undefined;
    return attempt && attempt.provider === provider ? outcome(attempt) : null;
  }

  /** Writes what the gateway said. One unit of work: the attempt is re-read inside it, so two callbacks settle once. */
  private static async record(attemptId: string, confirmation: GatewayConfirmation): Promise<GatewayOutcome> {
    return db.unit(async () => {
      const seen = db.findGatewayPaymentAttempt(attemptId);
      if (!seen) throw new NotFoundError("This payment attempt is not known.");
      // Everything the settlement reads is loaded before the attempt is looked at again: no await below this line.
      if (seen.scope === "STORE" && confirmation.status === "PAID") {
        const link = db.findPaymentLinkById(seen.tenant_id, seen.reference_id);
        if (link) await loadOrderRows(seen.tenant_id, [link.order_id]);
      }
      return this.apply(attemptId, confirmation);
    }, () => true);
  }

  private static apply(attemptId: string, confirmation: GatewayConfirmation): GatewayOutcome {
    const attempt = db.findGatewayPaymentAttempt(attemptId)!;
    if (attempt.status === "PAID") return outcome(attempt);
    const now = new Date().toISOString();

    if (confirmation.status !== "PAID") {
      // A cancelled or failed claim closes an open attempt; it never reopens or overrides anything.
      const next = confirmation.status === "PENDING" ? attempt.status : confirmation.status;
      const reason = confirmation.reason.slice(0, 300);
      // Asking again and hearing the same thing writes nothing
      if (next !== attempt.status || reason !== attempt.failure_reason) {
        db.saveGatewayPaymentAttempt({ ...attempt, status: next, failure_reason: reason, updated_at: now });
      }
      return outcome(attempt, confirmation.status);
    }

    const refuse = (reason: string): GatewayOutcome => {
      logger.error("payments.gateway.confirmation_mismatch", {
        attempt_id: attempt.id,
        tenant_id: attempt.tenant_id,
        provider: attempt.provider,
        reason,
        expected_amount: attempt.amount,
        confirmed_amount: confirmation.amount,
      });
      db.saveGatewayPaymentAttempt({ ...attempt, failure_reason: reason, updated_at: now });
      return outcome(attempt, "PENDING");
    };
    if (confirmation.attemptId !== attempt.id) return refuse("The gateway confirmed a different transaction.");
    if (confirmation.currency !== "BDT") return refuse("The gateway confirmed a payment in another currency.");
    if (!sameAmount(confirmation.amount, attempt.amount)) return refuse("The gateway confirmed a different amount.");
    const transactionId = confirmation.transactionId.trim().toUpperCase();
    if (db.findPaidGatewayAttemptByTransaction(attempt.provider, transactionId, attempt.id)) return refuse("This gateway transaction already paid another attempt.");
    // ...or a customer-submitted payment (ADR-124): one bKash transaction pays one thing
    if (attempt.scope === "STORE" && attempt.provider === "BKASH" && db.findPaymentByTransactionId(attempt.tenant_id, "BKASH", transactionId)) {
      return refuse("This bKash transaction is already recorded as a submitted payment.");
    }

    const paid: GatewayPaymentAttemptRecord = {
      ...attempt,
      status: "PAID",
      gateway_transaction_id: transactionId,
      failure_reason: undefined,
      completed_at: now,
      updated_at: now,
      ...(attempt.mode === "SANDBOX" && !sandboxSettles(attempt.scope) ? { test_only: true } : {}),
    };
    db.saveGatewayPaymentAttempt(paid);
    if (paid.test_only) return outcome(paid);
    if (paid.scope === "STORE") this.settleStorePayment(paid, confirmation.channel);
    else this.settleInvoice(paid);
    return outcome(paid);
  }

  /** Customer → shop: a PAID payment on the order, verified by the gateway. */
  private static settleStorePayment(attempt: GatewayPaymentAttemptRecord, channel?: string): void {
    const tenantId = attempt.tenant_id;
    const link = db.findPaymentLinkById(tenantId, attempt.reference_id);
    const order = link ? db.findOrderById(tenantId, link.order_id) : undefined;
    if (!link || !order) {
      // The money was taken but its order is gone: keep the paid attempt as the record and say so loudly.
      logger.error("payments.gateway.paid_without_order", { attempt_id: attempt.id, tenant_id: tenantId });
      return;
    }
    const now = new Date().toISOString();
    const verifier = `gateway:${attempt.provider}`;
    const payment: Payment = {
      id: `pay_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      order_id: order.id,
      provider: paymentMethodFor(attempt.provider, channel),
      transaction_id: attempt.gateway_transaction_id,
      amount: attempt.amount,
      currency: "BDT",
      status: "PAID",
      idempotency_key: `gateway:${attempt.id}`,
      verification_method: "GATEWAY",
      verified_by: verifier,
      verified_at: now,
      ...(attempt.mode === "SANDBOX" ? { test_mode: true } : {}),
      created_at: now,
    };
    const paidBefore = order.grand_total - amountDue(tenantId, order);
    db.createPayment(payment);
    PaymentLinkService.markPaidByPayment(payment, link.id);

    const fullyPaid = paidBefore + payment.amount >= order.grand_total - 0.5;
    // A cancelled order stays as it is: the payment is recorded and is the shop's to refund.
    if (fullyPaid && order.status !== "CANCELLED") db.updateOrderPaymentStatus(tenantId, order.id, "PAID");

    db.recordEvent({
      id: `evt_${Date.now()}_payment_completed_${randomSuffix()}`,
      type: "payment.completed",
      version: "1.0",
      tenant_id: tenantId,
      aggregate_type: "payment",
      aggregate_id: payment.id,
      actor_id: verifier,
      correlation_id: attempt.gateway_transaction_id ?? attempt.id,
      timestamp: now,
      payload: { order_id: order.id, amount: payment.amount, transaction_id: attempt.gateway_transaction_id, gateway: attempt.provider },
    });
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: tenantId,
      actor_user_id: verifier,
      action: "PAYMENT_VERIFIED",
      resource_type: "payment",
      resource_id: payment.id,
      metadata: {
        order_id: order.id,
        amount: payment.amount,
        transaction_id: attempt.gateway_transaction_id,
        method: "GATEWAY",
        gateway: attempt.provider,
        gateway_mode: attempt.mode,
        payment_link_id: link.id,
        order_fully_paid: fullyPaid,
        order_status: order.status,
      },
      created_at: now,
    });
  }

  /** Workspace → platform: the invoice is paid and the plan applies. */
  private static settleInvoice(attempt: GatewayPaymentAttemptRecord): void {
    const invoice = db.findBillingInvoiceById(attempt.tenant_id, attempt.reference_id);
    if (!invoice) {
      logger.error("billing.gateway.paid_without_invoice", { attempt_id: attempt.id, tenant_id: attempt.tenant_id });
      return;
    }
    if (invoice.status === "PAID") {
      // Paid twice (two attempts, or after an operator confirmed a transfer): the extra money is the platform's to refund.
      logger.error("billing.gateway.invoice_paid_twice", { attempt_id: attempt.id, tenant_id: attempt.tenant_id, invoice_id: invoice.id, amount: attempt.amount });
      return;
    }
    BillingService.settle(invoice, {
      method: attempt.provider,
      reference: attempt.gateway_transaction_id ?? attempt.id,
      verifiedBy: `gateway:${attempt.provider}`,
      gatewayAttemptId: attempt.id,
      testMode: attempt.mode === "SANDBOX",
    });
  }
}
