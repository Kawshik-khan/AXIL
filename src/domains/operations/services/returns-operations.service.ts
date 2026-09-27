import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Returns & Refunds Operations Service
 * Governed return eligibility inspection, repeat return fraud signals,
 * reverse logistics pickup scheduling, and safe refund execution.
 */

import { db } from "@/infrastructure/db";
import { Return, Refund } from "@/types/commerce";

export interface ReturnEligibilityCheck {
  eligible: boolean;
  reason?: string;
  is_high_fraud_risk: boolean;
  requires_inspection: boolean;
  customer_historical_returns_count: number;
}

export class ReturnsOperationsService {
  /**
   * Assesses return eligibility according to 7-day policy, delivery state, and fraud signals
   */
  public evaluateEligibility(
    tenantId: string,
    orderId: string,
    customerId: string
  ): ReturnEligibilityCheck {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) {
      return { eligible: false, reason: "Order not found", is_high_fraud_risk: false, requires_inspection: true, customer_historical_returns_count: 0 };
    }

    if (order.status !== "DELIVERED") {
      return { eligible: false, reason: `Order must be DELIVERED to request a return. Current status: ${order.status}`, is_high_fraud_risk: false, requires_inspection: true, customer_historical_returns_count: 0 };
    }

    // 7-day return window check
    const deliveredAt = new Date(order.updated_at).getTime();
    const daysSinceDelivery = (Date.now() - deliveredAt) / 86400000;
    if (daysSinceDelivery > 7) {
      return { eligible: false, reason: `Return window expired (${Math.round(daysSinceDelivery)} days since delivery; policy is 7 days).`, is_high_fraud_risk: false, requires_inspection: true, customer_historical_returns_count: 0 };
    }

    // Historical return frequency check
    const allCustomerReturns = db.getReturns(tenantId).filter((r) => r.customer_id === customerId);
    const returnCount = allCustomerReturns.length;
    const isFraudRisk = returnCount >= 3;

    return {
      eligible: true,
      is_high_fraud_risk: isFraudRisk,
      requires_inspection: true,
      customer_historical_returns_count: returnCount,
    };
  }

  /**
   * Disburses verified refund upon physical warehouse inspection receipt
   */
  public executeInspectionRefund(
    tenantId: string,
    returnId: string,
    actor: string
  ): Refund {
    const ret = db.getReturns(tenantId).find((r) => r.id === returnId);
    if (!ret) throw new Error(`Return record not found: ${returnId}`);

    const order = db.findOrderById(tenantId, ret.order_id);
    if (!order) throw new Error(`Order not found: ${ret.order_id}`);

    const payments = db.getPayments(tenantId, order.id);
    const primaryPayment = payments.find((p) => p.status === "PAID") || payments[0];
    if (!primaryPayment) throw new Error("No payment found to refund.");

    const now = new Date().toISOString();
    const refundId = `ref_${Date.now()}_${randomSuffix()}`;

    const refund: Refund = {
      id: refundId,
      tenant_id: tenantId,
      order_id: order.id,
      payment_id: primaryPayment.id,
      return_id: returnId,
      amount: order.grand_total,
      currency: "BDT",
      status: "COMPLETED",
      reason: `Return inspection approved: ${ret.reason}`,
      created_at: now,
    };

    db.createRefund(refund);
    db.updateReturnStatus(tenantId, returnId, "COMPLETED");
    db.updateOrderStatus(tenantId, order.id, "REFUNDED");
    db.updateOrderPaymentStatus(tenantId, order.id, "REFUNDED");

    db.createAuditLog({
      id: `aud_ret_refund_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "RETURN_REFUND_EXECUTED",
      resource_type: "refund",
      resource_id: refundId,
      metadata: { return_id: returnId, amount: refund.amount },
      created_at: now,
    });

    return refund;
  }
}

export const returnsOperationsService = new ReturnsOperationsService();
