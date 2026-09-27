/**
 * CommerceOS Phase 8: Autonomous Payment Operations Service
 * Payment transaction matching, bKash/Nagad verification, timeout recovery,
 * duplicate payment detection, and safe refund initiation.
 */

import { db } from "@/infrastructure/db";
import { PaymentOperation, PaymentException } from "@/types/operations";
import { Payment } from "@/types/commerce";

export class PaymentOperationsService {
  /**
   * Evaluates pending online payments and flags timed-out or stuck transactions
   */
  public monitorPendingPayments(tenantId: string): PaymentException[] {
    const payments = db.getPayments(tenantId);
    const existingExceptions = db.getPaymentExceptions(tenantId);
    const exceptions: PaymentException[] = [];
    const now = Date.now();

    for (const payment of payments) {
      if (payment.provider === "COD" || payment.status === "PAID" || payment.status === "REFUNDED") {
        continue;
      }

      const ageHours = (now - new Date(payment.created_at).getTime()) / 3600000;
      const alreadyReported = existingExceptions.some((e) => e.payment_id === payment.id && e.status !== "RESOLVED");

      // Timeout if pending > 2 hours without confirmation
      if (!alreadyReported && ageHours > 2) {
        const exc: PaymentException = {
          id: `pe_${payment.id}_${Date.now()}`,
          tenant_id: tenantId,
          payment_id: payment.id,
          order_id: payment.order_id,
          provider: payment.provider,
          amount: payment.amount,
          reason: "TRANSACTION_TIMEOUT",
          severity: payment.amount > 5000 ? "HIGH" : "MEDIUM",
          status: "OPEN",
          created_at: new Date().toISOString(),
        };

        db.createPaymentException(exc);
        exceptions.push(exc);
      }
    }

    return exceptions;
  }

  /**
   * Deterministically verifies an incoming transaction ID against payment records
   */
  public reconcileTransaction(
    tenantId: string,
    params: {
      orderId: string;
      transactionId: string;
      amount: number;
      actor: string;
    }
  ): { matched: boolean; payment?: Payment; error?: string } {
    // Same rules as PaymentService.verifyPayment (FX-11): normalized single-use TrxIDs, no re-verifying a PAID
    // payment, and the order is PAID only when verified payments cover its total.
    const transactionId = String(params.transactionId ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(transactionId)) {
      return { matched: false, error: "Transaction ID format is invalid (6-32 letters or digits)." };
    }
    params = { ...params, transactionId };

    const order = db.findOrderById(tenantId, params.orderId);
    const payments = db.getPayments(tenantId, params.orderId);
    if (!order || payments.length === 0) {
      return { matched: false, error: `No payment record exists for order ${params.orderId}` };
    }

    const alreadyVerified = payments.find((p) => p.status === "PAID" && (p.transaction_id || "").toUpperCase() === transactionId);
    if (alreadyVerified) {
      return { matched: true, payment: alreadyVerified }; // idempotent
    }
    const targetPayment = payments.find((p) => p.status !== "PAID");
    if (!targetPayment) {
      return { matched: false, error: `All payments for order ${params.orderId} are already verified.` };
    }

    // Check for duplicate transaction ID across tenant payments
    const duplicate = db.findPaymentByTransactionId(tenantId, targetPayment.provider, transactionId);

    if (duplicate) {
      const exc: PaymentException = {
        id: `pe_dup_${Date.now()}`,
        tenant_id: tenantId,
        payment_id: targetPayment.id,
        order_id: params.orderId,
        provider: targetPayment.provider,
        amount: params.amount,
        reason: "DUPLICATE_PAYMENT",
        severity: "CRITICAL",
        status: "OPEN",
        resolution_notes: `Transaction ID ${params.transactionId} already utilized on payment ${duplicate.id}`,
        created_at: new Date().toISOString(),
      };
      db.createPaymentException(exc);
      return { matched: false, error: `Duplicate transaction ID detected: ${params.transactionId}` };
    }

    // Amount match validation
    if (Math.abs(targetPayment.amount - params.amount) > 1.0) {
      const exc: PaymentException = {
        id: `pe_mismatch_${Date.now()}`,
        tenant_id: tenantId,
        payment_id: targetPayment.id,
        order_id: params.orderId,
        provider: targetPayment.provider,
        amount: params.amount,
        reason: "AMOUNT_MISMATCH",
        severity: "HIGH",
        status: "OPEN",
        resolution_notes: `Claimed amount ৳${params.amount} does not match expected ৳${targetPayment.amount}`,
        created_at: new Date().toISOString(),
      };
      db.createPaymentException(exc);
      return { matched: false, error: `Payment amount mismatch: expected ৳${targetPayment.amount}, got ৳${params.amount}` };
    }

    // Authoritative update
    const updated = db.recordPaymentVerification(tenantId, targetPayment.id, {
      transactionId,
      verifiedBy: params.actor,
      method: "MANUAL",
    });
    const paidTotal = db
      .getPayments(tenantId, params.orderId)
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + p.amount, 0);
    if (paidTotal >= order.grand_total - 0.5) {
      db.updateOrderPaymentStatus(tenantId, params.orderId, "PAID");
    }

    const op: PaymentOperation = {
      id: `pop_${Date.now()}`,
      tenant_id: tenantId,
      order_id: params.orderId,
      payment_id: targetPayment.id,
      operation_type: "VERIFY",
      provider: targetPayment.provider,
      amount: params.amount,
      transaction_id: params.transactionId,
      status: "SUCCESS",
      retry_count: 0,
      created_at: new Date().toISOString(),
    };
    db.recordPaymentOperation(op);

    return { matched: true, payment: updated };
  }
}

export const paymentOperationsService = new PaymentOperationsService();
