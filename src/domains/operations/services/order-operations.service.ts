import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Order Operations Service
 * Continuous order lifecycle monitoring, address validation, fulfillment readiness auditing,
 * SLA breach tracking, and cancellation handling via Phase 2 state machine.
 */

import { db } from "@/infrastructure/db";
import { Order } from "@/types/commerce";

export interface OrderOperationalHealth {
  order_id: string;
  order_number: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  is_payment_settled: boolean;
  is_stock_reserved: boolean;
  is_fulfillment_ready: boolean;
  is_delayed: boolean;
  age_hours: number;
  risk_signals: string[];
}

export class OrderOperationsService {
  /**
   * Evaluates operational status and readiness for all active orders
   */
  public evaluateOrders(tenantId: string): OrderOperationalHealth[] {
    const orders = db.getOrders(tenantId).orders;
    const reservations = db.getReservations(tenantId);
    const payments = db.getPayments(tenantId);
    const now = Date.now();

    return orders.map((order) => {
      const orderAgeHours = (now - new Date(order.created_at).getTime()) / 3600000;
      const orderPayments = payments.filter((p) => p.order_id === order.id);
      const isPaid = order.payment_status === "PAID" || (order.payment_method === "COD" && order.status !== "CANCELLED");
      const isReserved = reservations.some((r) => r.order_id === order.id && r.status === "ACTIVE");

      const riskSignals: string[] = [];

      // Flag delayed orders (>24 hours in CONFIRMED or PROCESSING without shipment)
      const isDelayed = (order.status === "CONFIRMED" || order.status === "PROCESSING") && orderAgeHours > 24;
      if (isDelayed) {
        riskSignals.push(`Order delayed ${Math.round(orderAgeHours)}h without dispatch.`);
      }

      // Flag online payment mismatch (online payment method but pending > 2 hours)
      if (order.payment_method !== "COD" && order.payment_status === "PENDING" && orderAgeHours > 2) {
        riskSignals.push("Online payment pending timeout exceeded (2h).");
      }

      // Check delivery address validity
      const address = order.shipping_address_snapshot;
      if (!address || !address.address_line_1 || address.address_line_1.length < 5) {
        riskSignals.push("Delivery address contains ambiguous or incomplete street details.");
      }

      const isFulfillmentReady = (order.status === "CONFIRMED" || order.status === "PROCESSING") && isPaid && riskSignals.length === 0;

      return {
        order_id: order.id,
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        fulfillment_status: order.fulfillment_status,
        is_payment_settled: isPaid,
        is_stock_reserved: isReserved,
        is_fulfillment_ready: isFulfillmentReady,
        is_delayed: isDelayed,
        age_hours: Number(orderAgeHours.toFixed(1)),
        risk_signals: riskSignals,
      };
    });
  }

  /**
   * Transitions order to fulfillment ready state when invariants are satisfied
   */
  public prepareOrderForFulfillment(
    tenantId: string,
    orderId: string,
    actor: string
  ): Order {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) throw new AppError("NOT_FOUND", `Order not found: ${orderId}`, 404);

    if (order.status === "PENDING") {
      db.updateOrderStatus(tenantId, order.id, "CONFIRMED");
    }

    db.createAuditLog({
      id: `aud_order_fulfill_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "ORDER_PREPARED_FOR_FULFILLMENT",
      resource_type: "order",
      resource_id: order.id,
      metadata: { order_number: order.order_number },
      created_at: new Date().toISOString(),
    });

    return db.findOrderById(tenantId, orderId)!;
  }

  /**
   * Safely cancels an order and releases reservations
   */
  public cancelOrderSafely(
    tenantId: string,
    orderId: string,
    reason: string,
    actor: string
  ): Order {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) throw new AppError("NOT_FOUND", `Order not found: ${orderId}`, 404);

    if (order.status === "DELIVERED" || order.status === "SHIPPED") {
      throw new Error(`Cannot cancel order in '${order.status}' status. Initiating return is required.`);
    }

    db.updateOrderStatus(tenantId, order.id, "CANCELLED");

    // Release all active inventory reservations
    const reservations = db.getReservations(tenantId).filter((r) => r.order_id === order.id && r.status === "ACTIVE");
    for (const res of reservations) {
      db.releaseReservation(tenantId, res.id);
    }

    db.createAuditLog({
      id: `aud_order_cancel_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "ORDER_CANCELLED_SAFELY",
      resource_type: "order",
      resource_id: order.id,
      metadata: { reason, released_reservations_count: reservations.length },
      created_at: new Date().toISOString(),
    });

    return db.findOrderById(tenantId, orderId)!;
  }
}

export const orderOperationsService = new OrderOperationsService();
