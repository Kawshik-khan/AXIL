/**
 * CommerceOS Phase 6: Payment Intelligence Service
 * Gateway success rates, bKash/Nagad reconciliation tracking, and payment failure monitoring.
 */

import { db } from "@/infrastructure/db";

export interface PaymentMethodMetrics {
  method: string;
  total_attempts: number;
  successful_count: number;
  failed_count: number;
  success_rate_pct: number;
  total_volume_bdt: number;
}

export interface PaymentIntelligenceSummary {
  tenant_id: string;
  overall_success_rate_pct: number;
  total_settled_bdt: number;
  unreconciled_cod_bdt: number;
  failure_spike_detected: boolean;
  methods: PaymentMethodMetrics[];
  generated_at: string;
}

export class PaymentIntelligenceService {
  /**
   * Evaluates payment gateway metrics and reconciliation status
   */
  public analyzePayments(tenantId: string): PaymentIntelligenceSummary {
    const payments = db.getPayments(tenantId);
    const orders = db.getAllOrders(tenantId, { hydrate: true });

    const methodStats: Record<
      string,
      { attempts: number; successful: number; failed: number; volume: number }
    > = {};

    let totalVolume = 0;
    let totalSuccessful = 0;
    let totalAttempts = payments.length;

    for (const p of payments) {
      const m = (p as any).provider || (p as any).method || "COD";
      if (!methodStats[m]) {
        methodStats[m] = { attempts: 0, successful: 0, failed: 0, volume: 0 };
      }
      methodStats[m].attempts += 1;
      if (p.status === "PAID") {
        methodStats[m].successful += 1;
        methodStats[m].volume += p.amount || 0;
        totalSuccessful += 1;
        totalVolume += p.amount || 0;
      } else if (p.status === "FAILED") {
        methodStats[m].failed += 1;
      }
    }

    const methods: PaymentMethodMetrics[] = Object.entries(methodStats).map(([method, stats]) => ({
      method,
      total_attempts: stats.attempts,
      successful_count: stats.successful,
      failed_count: stats.failed,
      success_rate_pct: stats.attempts > 0 ? Number(((stats.successful / stats.attempts) * 100).toFixed(1)) : 100,
      total_volume_bdt: Number(stats.volume.toFixed(2)),
    }));

    // COD Unreconciled: Orders delivered via COD where payment status is still pending/unverified
    const deliveredCodOrders = orders.filter(
      (o) => o.status === "DELIVERED" && o.payment_method === "COD" && o.payment_status !== "PAID"
    );
    const unreconciledCod = deliveredCodOrders.reduce((sum, o) => sum + (o.grand_total || (o as any).total_amount || 0), 0);

    const overallSuccessRate =
      totalAttempts > 0 ? Number(((totalSuccessful / totalAttempts) * 100).toFixed(1)) : 100;

    const failureSpike = methods.some((m) => m.failed_count >= 3 && m.success_rate_pct < 80);

    return {
      tenant_id: tenantId,
      overall_success_rate_pct: overallSuccessRate,
      total_settled_bdt: Number(totalVolume.toFixed(2)),
      unreconciled_cod_bdt: Number(unreconciledCod.toFixed(2)),
      failure_spike_detected: failureSpike,
      methods,
      generated_at: new Date().toISOString(),
    };
  }
}

export const paymentIntelligenceService = new PaymentIntelligenceService();
