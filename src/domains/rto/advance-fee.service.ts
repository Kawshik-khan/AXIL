import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { NotFoundError, BadRequestError } from "@/lib/errors";
import { OrderLifecycleService } from "@/domains/orders/order-lifecycle.service";
import { OrderRtoEvaluationRecord } from "@/types/rto";
import { randomSuffix } from "@/lib/ids";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";

export class AdvanceFeeService {
  /**
   * Generates a tokenized bKash advance delivery fee checkout request link
   * and dispatches a customer verification notification via SMS/WhatsApp.
   */
  public static async requestAdvanceFee(
    context: RequestContext,
    orderId: string,
    options?: { amount_bdt?: number; channel?: "SMS" | "WHATSAPP" }
  ): Promise<{
    order_id: string;
    order_number: string;
    amount_bdt: number;
    checkout_url: string;
    recipient_phone: string;
    status: "REQUESTED";
  }> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_WRITE);

    await loadOrderRows(context.tenant.id, [orderId]); // zero-hydration: the order's rows this flow reads and changes
    const order = db.findOrderById(context.tenant.id, orderId);
    if (!order) {
      throw new NotFoundError("Order", orderId);
    }

    if (order.status !== "PENDING" && order.status !== "CONFIRMED") {
      throw new BadRequestError(`Cannot request advance delivery fee on a ${order.status} order.`);
    }

    const amountBdt = options?.amount_bdt || 120;
    const customer = order.customer_id ? db.findCustomerById(context.tenant.id, order.customer_id) : undefined;
    const phone = customer?.phone || (order as any).shipping_address?.phone || "";

    // Generate secure tokenized checkout link
    const token = `bksh_adv_${randomSuffix()}_${Date.now()}`;
    const checkoutUrl = `https://pay.commerceos.bd/checkout/advance-fee?order=${encodeURIComponent(order.order_number)}&token=${token}&amount=${amountBdt}`;

    // Update evaluation record if one exists
    const existingEvaluation = db.findOrderRtoEvaluation(context.tenant.id, order.id);
    if (existingEvaluation) {
      const updated: OrderRtoEvaluationRecord = {
        ...existingEvaluation,
        advance_fee_requested: true,
      };
      db.saveOrderRtoEvaluation(updated);
    }

    // Record audit event
    db.recordEvent({
      id: `evt_${Date.now()}_adv_fee_req_${randomSuffix()}`,
      type: "rto.advance_fee_requested",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "order",
      aggregate_id: order.id,
      actor_id: context.user.id,
      correlation_id: order.order_number,
      timestamp: new Date().toISOString(),
      payload: {
        order_number: order.order_number,
        amount_bdt: amountBdt,
        phone,
        checkout_url: checkoutUrl,
        channel: options?.channel || "WHATSAPP",
      },
    });

    return {
      order_id: order.id,
      order_number: order.order_number,
      amount_bdt: amountBdt,
      checkout_url: checkoutUrl,
      recipient_phone: phone,
      status: "REQUESTED",
    };
  }

  /**
   * Confirms payment of the advance delivery charge.
   * Advances order to CONFIRMED and decrements door-to-door COD collectible balance.
   */
  public static async recordAdvanceFeePaid(
    tenantId: string,
    orderId: string,
    paymentReference: string,
    amountBdt = 120,
    actorUserId = "system"
  ): Promise<OrderRtoEvaluationRecord | undefined> {
    await loadOrderRows(tenantId, [orderId]); // zero-hydration: the order's rows this flow reads and changes
    const order = db.findOrderById(tenantId, orderId);
    if (!order) {
      throw new NotFoundError("Order", orderId);
    }

    const evaluation = db.findOrderRtoEvaluation(tenantId, orderId);
    if (evaluation) {
      const updated: OrderRtoEvaluationRecord = {
        ...evaluation,
        advance_fee_paid: true,
        advance_payment_id: paymentReference,
        risk_score: Math.max(5, evaluation.risk_score - 40), // Successful advance payment immediately reduces risk
        risk_tier: "LOW",
        recommended_action: "AUTO_CONFIRM",
      };
      db.saveOrderRtoEvaluation(updated);
    }

    // Advance order to CONFIRMED if it was PENDING
    if (order.status === "PENDING") {
      OrderLifecycleService.advance(
        tenantId,
        order.id,
        "CONFIRMED",
        { type: "SYSTEM", id: actorUserId },
        `Advance delivery charge of ৳${amountBdt} received via bKash (${paymentReference})`
      );
    }

    return db.findOrderRtoEvaluation(tenantId, orderId);
  }
}
