import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Return, Refund, ReturnStatus } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class ReturnService {
  public static async listReturns(context: RequestContext): Promise<Return[]> {
    RbacService.assertCan(context, PERMISSIONS.RETURNS_READ);
    return db.getReturns(context.tenant.id);
  }

  public static async requestReturn(
    context: RequestContext,
    payload: {
      order_id: string;
      reason: string;
      notes?: string;
    }
  ): Promise<Return> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_UPDATE);

    const order = db.findOrderById(context.tenant.id, payload.order_id);
    if (!order) {
      throw new NotFoundError(`Order '${payload.order_id}' not found.`);
    }

    if (order.status !== "DELIVERED") {
      throw new BadRequestError(`Cannot request return for order in '${order.status}' status. Only DELIVERED orders can be returned.`);
    }

    const returnId = `ret_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    const returnRecord: Return = {
      id: returnId,
      tenant_id: context.tenant.id,
      order_id: payload.order_id,
      customer_id: order.customer_id,
      status: "REQUESTED",
      reason: payload.reason,
      notes: payload.notes,
      requested_at: now,
      created_at: now,
      updated_at: now,
    };

    const created = db.createReturn(returnRecord);
    db.updateOrderStatus(context.tenant.id, order.id, "RETURN_REQUESTED");

    db.recordEvent({
      id: `evt_${Date.now()}_return_created`,
      type: "return.created",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "return",
      aggregate_id: returnId,
      actor_id: context.user.id,
      correlation_id: order.order_number,
      timestamp: now,
      payload: { order_id: order.id, reason: payload.reason },
    });

    return created;
  }

  public static async receiveReturn(
    context: RequestContext,
    returnId: string
  ): Promise<Return> {
    RbacService.assertCan(context, PERMISSIONS.RETURNS_MANAGE);

    const ret = db.getReturns(context.tenant.id).find((r) => r.id === returnId);
    if (!ret) {
      throw new NotFoundError(`Return '${returnId}' not found.`);
    }

    const updated = db.updateReturnStatus(context.tenant.id, returnId, "RECEIVED");
    if (!updated) {
      throw new NotFoundError(`Return '${returnId}' could not be updated.`);
    }

    db.updateOrderStatus(context.tenant.id, ret.order_id, "RETURNED");
    return updated;
  }

  public static async processRefund(
    context: RequestContext,
    payload: {
      order_id: string;
      return_id?: string;
      amount?: number;
      reason: string;
    }
  ): Promise<Refund> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_REFUND);

    const order = db.findOrderById(context.tenant.id, payload.order_id);
    if (!order) {
      throw new NotFoundError(`Order '${payload.order_id}' not found.`);
    }

    const payments = db.getPayments(context.tenant.id, order.id);
    const primaryPayment = payments.find((p) => p.status === "PAID") || payments[0];
    if (!primaryPayment) {
      throw new BadRequestError("No payment found to refund for this order.");
    }

    const refundAmount = payload.amount || order.grand_total;
    const refundId = `ref_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    const refund: Refund = {
      id: refundId,
      tenant_id: context.tenant.id,
      order_id: order.id,
      payment_id: primaryPayment.id,
      return_id: payload.return_id,
      amount: refundAmount,
      currency: "BDT",
      status: "COMPLETED",
      reason: payload.reason,
      created_at: now,
    };

    const created = db.createRefund(refund);

    // Update payment and order states
    db.updatePaymentStatus(context.tenant.id, primaryPayment.id, "REFUNDED");
    db.updateOrderPaymentStatus(context.tenant.id, order.id, "REFUNDED");
    db.updateOrderStatus(context.tenant.id, order.id, "REFUNDED");

    if (payload.return_id) {
      db.updateReturnStatus(context.tenant.id, payload.return_id, "COMPLETED");
    }

    db.recordEvent({
      id: `evt_${Date.now()}_refund_completed`,
      type: "refund.completed",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "refund",
      aggregate_id: refundId,
      actor_id: context.user.id,
      correlation_id: order.order_number,
      timestamp: now,
      payload: {
        order_id: order.id,
        amount: refundAmount,
        reason: payload.reason,
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "REFUND_PROCESSED",
      resource_type: "refund",
      resource_id: refundId,
      metadata: { order_id: order.id, amount: refundAmount },
      created_at: now,
    });

    return created;
  }
}
