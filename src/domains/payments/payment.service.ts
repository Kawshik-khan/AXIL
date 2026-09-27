import { db } from "@/infrastructure/db";
import { Payment, PaymentMethod, PaymentStatus } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError, ConflictError } from "@/lib/errors";

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

    const order = db.findOrderById(context.tenant.id, payload.order_id);
    if (!order) {
      throw new NotFoundError(`Order '${payload.order_id}' not found.`);
    }

    // Idempotency check
    if (payload.idempotency_key) {
      const existing = db.findPaymentByIdempotency(context.tenant.id, payload.idempotency_key);
      if (existing) {
        return existing;
      }
    }

    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
      id: `evt_${Date.now()}_payment_created`,
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
      id: `aud_${Date.now()}`,
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

  public static async verifyPayment(
    context: RequestContext,
    paymentId: string,
    transactionId: string
  ): Promise<Payment> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_READ);

    const payment = db.findPaymentById(context.tenant.id, paymentId);
    if (!payment) {
      throw new NotFoundError(`Payment '${paymentId}' not found.`);
    }

    if (payment.status === "PAID") {
      return payment; // Idempotent return
    }

    const updated = db.updatePaymentStatus(context.tenant.id, paymentId, "PAID", transactionId);
    if (!updated) {
      throw new NotFoundError(`Payment '${paymentId}' could not be updated.`);
    }

    // Synchronize order payment status
    db.updateOrderPaymentStatus(context.tenant.id, payment.order_id, "PAID");

    db.recordEvent({
      id: `evt_${Date.now()}_payment_completed`,
      type: "payment.completed",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "payment",
      aggregate_id: paymentId,
      actor_id: context.user.id,
      correlation_id: transactionId,
      timestamp: new Date().toISOString(),
      payload: {
        order_id: payment.order_id,
        amount: payment.amount,
        transaction_id: transactionId,
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PAYMENT_VERIFIED",
      resource_type: "payment",
      resource_id: paymentId,
      metadata: { transaction_id: transactionId, amount: payment.amount },
      created_at: new Date().toISOString(),
    });

    return updated;
  }
}
