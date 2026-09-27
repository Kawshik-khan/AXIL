import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Operational Finance Service
 * Deterministic revenue reconciliation, courier Cash on Delivery (COD) audit,
 * settlement variance detection, fee anomaly checks, and financial exception tracking.
 * All computations are purely deterministic (zero LLM calculations).
 */

import { db } from "@/infrastructure/db";
import {
  ReconciliationRun,
  ReconciliationItem,
  FinancialException,
  SettlementRecord,
} from "@/types/operations";

export class FinanceOperationsService {
  /**
   * Executes deterministic daily revenue and payment reconciliation
   */
  public executeReconciliationRun(tenantId: string): ReconciliationRun {
    const orders = db.getOrders(tenantId).orders;
    const payments = db.getPayments(tenantId);
    const runId = `rec_run_${Date.now()}_${randomSuffix()}`;
    const today = new Date().toISOString().split("T")[0];

    let totalExpected = 0;
    let totalCollected = 0;
    let discrepancyCount = 0;
    let totalDiscrepancyAmount = 0;

    for (const order of orders) {
      if (order.status === "CANCELLED") continue;

      totalExpected += order.grand_total;
      const orderPayments = payments.filter((p) => p.order_id === order.id);
      const paidSum = orderPayments
        .filter((p) => p.status === "PAID")
        .reduce((sum, p) => sum + p.amount, 0);

      totalCollected += paidSum;
      const variance = Math.round((order.grand_total - paidSum) * 100) / 100;

      const isDiscrepancy = order.status === "DELIVERED" && variance > 0;
      if (isDiscrepancy) {
        discrepancyCount++;
        totalDiscrepancyAmount += variance;
      }

      const item: ReconciliationItem = {
        id: `ri_${order.id}_${Date.now()}`,
        run_id: runId,
        tenant_id: tenantId,
        order_id: order.id,
        order_number: order.order_number,
        payment_method: order.payment_method,
        expected_amount: order.grand_total,
        actual_settled_amount: paidSum,
        variance_amount: variance,
        status: isDiscrepancy ? "DISCREPANCY" : "MATCHED",
        discrepancy_reason: isDiscrepancy ? `Delivered order has unsettled variance of ৳${variance}` : undefined,
      };

      db.createReconciliationItem(item);

      if (isDiscrepancy) {
        const finExc: FinancialException = {
          id: `fexc_${order.id}_${Date.now()}`,
          tenant_id: tenantId,
          category: "COD_DISCREPANCY",
          amount_bdt: variance,
          severity: variance > 3000 ? "HIGH" : "MEDIUM",
          description: `Order ${order.order_number} marked DELIVERED but courier COD settlement of ৳${variance} is missing.`,
          status: "DETECTED",
          proposed_action: "Generate courier COD dispute and notify finance lead.",
          created_at: new Date().toISOString(),
        };
        db.createFinancialException(finExc);
      }
    }

    const run: ReconciliationRun = {
      id: runId,
      tenant_id: tenantId,
      run_date: today,
      orders_audited_count: orders.length,
      total_revenue_expected_bdt: totalExpected,
      total_revenue_collected_bdt: totalCollected,
      discrepancies_found_count: discrepancyCount,
      total_discrepancy_amount_bdt: totalDiscrepancyAmount,
      status: discrepancyCount > 0 ? "EXCEPTIONS_FOUND" : "COMPLETED",
      created_at: new Date().toISOString(),
    };

    db.createReconciliationRun(run);
    return run;
  }

  /**
   * Audits third-party gateway/courier settlement fee deduction against agreed rates
   */
  public auditSettlementFees(
    tenantId: string,
    settlement: {
      provider: string;
      batchId: string;
      grossAmountBdt: number;
      actualFeeBdt: number;
      agreedFeePercent: number;
    }
  ): {
    expectedFeeBdt: number;
    varianceBdt: number;
    hasAnomaly: boolean;
    exceptionId?: string;
  } {
    const expectedFee = Math.round((settlement.grossAmountBdt * (settlement.agreedFeePercent / 100)) * 100) / 100;
    const variance = Math.round((settlement.actualFeeBdt - expectedFee) * 100) / 100;
    const hasAnomaly = variance > 50; // Overcharged by > ৳50

    let exceptionId: string | undefined;
    if (hasAnomaly) {
      const exc: FinancialException = {
        id: `fexc_fee_${Date.now()}_${randomSuffix()}`,
        tenant_id: tenantId,
        category: "FEE_ANOMALY",
        amount_bdt: variance,
        severity: variance > 500 ? "HIGH" : "MEDIUM",
        description: `Provider ${settlement.provider} overcharged fees by ৳${variance} on batch ${settlement.batchId}.`,
        status: "DETECTED",
        proposed_action: `Issue dispute statement to ${settlement.provider} billing department.`,
        created_at: new Date().toISOString(),
      };
      db.createFinancialException(exc);
      exceptionId = exc.id;
    }

    return {
      expectedFeeBdt: expectedFee,
      varianceBdt: variance,
      hasAnomaly,
      exceptionId,
    };
  }
}

export const financeOperationsService = new FinanceOperationsService();
