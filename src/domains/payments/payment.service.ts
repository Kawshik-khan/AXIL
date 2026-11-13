import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Payment, PaymentMethod, PaymentStatus } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/errors";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";
import { PaymentLinkService } from "./payment-link.service";

export class PaymentService {
  public static async listPayments(
    context: RequestContext,
    orderId?: string
  ): Promise<Payment[]> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_READ);
    return db.getPayments(context.tenant.id, orderId);
  }

  public static async createPayment(
    context: RequestContext,
    payload: {
      order_id: string;
      provider: PaymentMethod;
      amount: number;
      transaction_id?: string;
      idempotency_key?: string;
    }
  ): Promise<Payment> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_WRITE);

    await loadOrderRows(context.tenant.id, [payload.order_id]); // zero-hydration: the order's rows this flow reads and changes
    const order = db.findOrderById(context.tenant.id, payload.order_id);
    if (!order) {
      throw new NotFoundError("Order", payload.order_id);
    }
    if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount <= 0 || payload.amount > order.grand_total + 0.5) {
      throw new ValidationError("Payment amount must be greater than 0 and no more than the order total.", {
        amount: payload.amount,
        grand_total: order.grand_total,
      });
    }

    // Idempotency check
    if (payload.idempotency_key) {
      const existing = db.findPaymentByIdempotency(context.tenant.id, payload.idempotency_key);
      if (existing) {
        return existing;
      }
    }

    const paymentId = `pay_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    // COD starts as PENDING; online MFS can start as PENDING or AUTHORIZED
    const initialStatus: PaymentStatus = payload.provider === "COD" ? "PENDING" : "PENDING";

    const payment: Payment = {
      id: paymentId,
      tenant_id: context.tenant.id,
      order_id: payload.order_id,
      provider: payload.provider,
      transaction_id: payload.transaction_id,
      amount: payload.amount,
      currency: "BDT",
      status: initialStatus,
      idempotency_key: payload.idempotency_key,
      created_at: now,
    };

    const created = db.createPayment(payment);

    db.recordEvent({
      id: `evt_${Date.now()}_payment_created_${randomSuffix()}`,
      type: "payment.created",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "payment",
      aggregate_id: paymentId,
      actor_id: context.user.id,
      correlation_id: order.order_number,
      timestamp: now,
      payload: {
        order_id: payload.order_id,
        amount: payload.amount,
        provider: payload.provider,
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PAYMENT_RECORDED",
      resource_type: "payment",
      resource_id: paymentId,
      metadata: { order_id: payload.order_id, amount: payload.amount, provider: payload.provider },
      created_at: now,
    });

    return created;
  }

  /**
   * The money for a PENDING payment never arrived (a wrong or made-up transaction id): it becomes FAILED. The
   * id stays on the failed row, so the same id can't be submitted again. Needs PAYMENTS_VERIFY, like confirming one.
   * A PAID payment is never changed here.
   */
  public static async rejectPayment(context: RequestContext, paymentId: string): Promise<Payment> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_VERIFY);
    const payment = db.findPaymentById(context.tenant.id, paymentId);
    if (!payment) {
      throw new NotFoundError("Payment", paymentId);
    }
    if (payment.status === "FAILED") return payment;
    if (payment.status !== "PENDING") {
      throw new ConflictError(`A ${payment.status.toLowerCase()} payment can't be rejected.`);
    }
    const updated = db.updatePaymentStatus(context.tenant.id, paymentId, "FAILED");
    if (!updated) {
      throw new NotFoundError("Payment", paymentId);
    }
    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PAYMENT_REJECTED",
      resource_type: "payment",
      resource_id: paymentId,
      metadata: { order_id: payment.order_id, amount: payment.amount, provider: payment.provider, transaction_id: payment.transaction_id ?? null },
      created_at: new Date().toISOString(),
    });
    return updated;
  }

  /**
   * Marks a payment PAID after a user checked its provider transaction id (FX-11, audit H3).
   * - Needs PAYMENTS_VERIFY (PAYMENTS_READ alone used to be enough).
   * - A TrxID can be attached to only one payment; re-verifying with the same TrxID is idempotent.
   * - A payment may be partial (e.g. a bKash advance for the delivery fee), but it can't exceed what is still due,
   *   and the order becomes PAID only once verified payments cover its grand total.
   * No provider is contacted yet: the verification is recorded as MANUAL with the verifying user (FX-52 adds gateways).
   */
  public static async verifyPayment(
    context: RequestContext,
    paymentId: string,
    transactionId: string
  ): Promise<Payment> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_VERIFY);

    const trx = String(transactionId ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(trx)) {
      throw new ValidationError("Transaction ID format is invalid (6-32 letters or digits).");
    }

    return this.confirmPending(context.tenant.id, paymentId, trx, { id: context.user.id, method: "MANUAL" });
  }

  /**
   * bKash's own record matched a pending payment's transaction id (ADR-124) and the platform allows confirming on that:
   * the same checks as a staff confirmation, recorded as GATEWAY by "gateway:BKASH_LOOKUP". Sandbox money is marked TEST.
   */
  public static async confirmFromGatewayLookup(tenantId: string, paymentId: string, transactionId: string, testMode: boolean): Promise<Payment> {
    return this.confirmPending(tenantId, paymentId, transactionId.trim().toUpperCase(), { id: "gateway:BKASH_LOOKUP", method: "GATEWAY", testMode });
  }

  private static async confirmPending(
    tenantId: string,
    paymentId: string,
    trx: string,
    actor: { id: string; method: "MANUAL" | "GATEWAY"; testMode?: boolean }
  ): Promise<Payment> {
    const payment = db.findPaymentById(tenantId, paymentId);
    if (!payment) {
      throw new NotFoundError("Payment", paymentId);
    }

    if (payment.status === "PAID") {
      if ((payment.transaction_id || "").trim().toUpperCase() === trx) return payment; // idempotent
      throw new ConflictError("Payment is already verified with a different transaction ID.");
    }

    if (payment.status === "FAILED") {
      throw new ConflictError("This payment was rejected. Record a new payment instead of confirming a rejected one.");
    }

    const reused = db.findPaymentByTransactionId(tenantId, payment.provider, trx);
    if (reused && reused.id !== payment.id) {
      throw new ConflictError("This transaction ID is already attached to another payment.", { payment_id: reused.id });
    }

    await loadOrderRows(tenantId, [payment.order_id]); // zero-hydration: the order's rows this flow reads and changes
    const order = db.findOrderById(tenantId, payment.order_id);
    if (!order) {
      throw new NotFoundError("Order", payment.order_id);
    }
    const paidSoFar = db
      .getPayments(tenantId, order.id)
      .filter((p) => p.status === "PAID" && p.id !== payment.id)
      .reduce((sum, p) => sum + p.amount, 0);
    const due = order.grand_total - paidSoFar;
    if (!(payment.amount > 0) || payment.amount > due + 0.5) {
      throw new ValidationError("Payment amount must be positive and no more than the amount still due.", {
        amount: payment.amount,
        due,
      });
    }

    const updated = db.recordPaymentVerification(tenantId, paymentId, {
      transactionId: trx,
      verifiedBy: actor.id,
      method: actor.method,
      testMode: actor.testMode,
    });
    if (!updated) {
      throw new NotFoundError("Payment", paymentId);
    }

    const fullyPaid = paidSoFar + payment.amount >= order.grand_total - 0.5;
    if (fullyPaid) {
      db.updateOrderPaymentStatus(tenantId, payment.order_id, "PAID");
    }
    // A payment a customer submitted through a payment link: the link is now paid (ADR-123).
    PaymentLinkService.markPaidByPayment(updated);
    const transactionIdForRecords = trx;

    db.recordEvent({
      id: `evt_${Date.now()}_payment_completed_${randomSuffix()}`,
      type: "payment.completed",
      version: "1.0",
      tenant_id: tenantId,
      aggregate_type: "payment",
      aggregate_id: paymentId,
      actor_id: actor.id,
      correlation_id: transactionIdForRecords,
      timestamp: new Date().toISOString(),
      payload: {
        order_id: payment.order_id,
        amount: payment.amount,
        transaction_id: transactionIdForRecords,
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor.id,
      action: "PAYMENT_VERIFIED",
      resource_type: "payment",
      resource_id: paymentId,
      metadata: { transaction_id: transactionIdForRecords, amount: payment.amount, order_fully_paid: fullyPaid, method: actor.method, ...(actor.testMode ? { test_mode: true } : {}) },
      created_at: new Date().toISOString(),
    });

    return updated;
  }
}
