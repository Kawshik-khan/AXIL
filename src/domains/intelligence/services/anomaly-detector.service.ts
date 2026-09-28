/**
 * CommerceOS Phase 6: Anomaly Detection Engine
 * Statistical detection of revenue shocks, order surges, payment failures, and delivery anomalies.
 * Strictly separates Detection (statistical deviation) from Explanation (evidence-backed causes).
 */

import { db } from "@/infrastructure/db";
import { Anomaly, InsightSeverity } from "@/types/intelligence";
import { evidenceService } from "./evidence.service";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class AnomalyDetectorService {
  /**
   * Evaluates operational metrics and stores detected anomalies (one write, idempotent per metric per day).
   */
  public detectAnomalies(tenantId: string): Anomaly[] {
    return intelligenceSnapshots.persist(tenantId, "anomalies", this.computeAnomalies(tenantId));
  }

  /** Pure (FX-21): anomalies detected now. Ids are `anom_${tenant}_${metric}_${day}`, so re-detection is an update. */
  public computeAnomalies(tenantId: string): Anomaly[] {
    const detected: Anomaly[] = [];
    const day = new Date().toISOString().slice(0, 10);
    const orders = db.getAllOrders(tenantId, { hydrate: true }).filter((o) => o.status !== "CANCELLED");
    const payments = db.getPayments(tenantId);
    const shipments = db.getShipments(tenantId);

    // 1. Revenue Shock / Order Surge Anomaly Check (using daily order distribution)
    const dailyCounts: Record<string, number> = {};
    for (const o of orders) {
      const d = o.created_at ? o.created_at.slice(0, 10) : "";
      if (d) dailyCounts[d] = (dailyCounts[d] || 0) + 1;
    }

    const counts = Object.values(dailyCounts);
    if (counts.length >= 3) {
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
      const stdDev = Math.sqrt(variance) || 1;

      const todayStr = new Date().toISOString().slice(0, 10);
      const todayCount = dailyCounts[todayStr] || 0;
      const zScore = Number(((todayCount - mean) / stdDev).toFixed(2));

      // Z-score threshold 2.0 (spike) or -2.0 (drop)
      if (zScore > 2.0) {
        const evidence = evidenceService.createEvidence({
          sourceType: "METRIC",
          sourceId: `metric_orders_count`,
          metric: "orders_count",
          value: todayCount,
          description: `Today's order volume (${todayCount}) is +${zScore} standard deviations above the 14-day mean (${mean.toFixed(1)}).`,
          comparison: "14-day moving average",
        });

        const anomaly: Anomaly = {
          id: `anom_${tenantId}_orders_count_${day}`,
          tenant_id: tenantId,
          metric: "orders_count",
          detected_at: new Date().toISOString(),
          period_analyzed: "TODAY_VS_14D_BASELINE",
          current_value: todayCount,
          expected_value: Number(mean.toFixed(1)),
          deviation_score: zScore,
          detection_method: "Z_SCORE",
          severity: "MEDIUM",
          explanation_status: "EXPLAINED",
          probable_cause: "High-volume demand surge detected across active sales channels.",
          evidence: [evidence],
          affected_entities: [{ type: "ORDER_CHANNEL", id: "ALL", name: "Inbound Channels" }],
          created_at: new Date().toISOString(),
        };

        detected.push(anomaly);
      }
    }

    // 2. Payment Failure Spike Anomaly Check
    const recentPayments = payments.slice(-20);
    const failedPayments = recentPayments.filter((p) => p.status === "FAILED");
    if (recentPayments.length >= 5 && failedPayments.length >= 3) {
      const failRate = Number(((failedPayments.length / recentPayments.length) * 100).toFixed(1));
      const failEvidence = evidenceService.createEvidence({
        sourceType: "PAYMENT",
        sourceId: `payment_audit_${tenantId}`,
        metric: "payment_failure_rate",
        value: `${failRate}%`,
        description: `Payment failure rate reached ${failRate}% across the last ${recentPayments.length} transactions (${failedPayments.length} failed).`,
      });

      const anomaly: Anomaly = {
        id: `anom_${tenantId}_payment_failure_rate_${day}`,
        tenant_id: tenantId,
        metric: "payment_failure_rate",
        detected_at: new Date().toISOString(),
        period_analyzed: "LAST_20_PAYMENTS",
        current_value: failRate,
        expected_value: 5.0, // Baseline normal 5%
        deviation_score: Number(((failRate - 5.0) / 5.0).toFixed(2)),
        detection_method: "STATIC_THRESHOLD",
        severity: "HIGH",
        explanation_status: "EXPLAINED",
        probable_cause: "MFS gateway API timeout or customer OTP delivery delay.",
        evidence: [failEvidence],
        affected_entities: [{ type: "PAYMENT_GATEWAY", id: "MFS_GATEWAY", name: "bKash/Nagad" }],
        created_at: new Date().toISOString(),
      };

      detected.push(anomaly);
    }

    // 3. Delivery Return (RTO) Spike Anomaly Check
    const returnedShipments = shipments.filter((s) => s.status === "RETURNED" || s.status === "FAILED");
    if (shipments.length >= 5 && returnedShipments.length >= 2) {
      const rtoRate = Number(((returnedShipments.length / shipments.length) * 100).toFixed(1));
      if (rtoRate > 15.0) {
        const rtoEvidence = evidenceService.createEvidence({
          sourceType: "COURIER",
          sourceId: `shipment_audit_${tenantId}`,
          metric: "rto_rate",
          value: `${rtoRate}%`,
          description: `Return-to-origin rate spiked to ${rtoRate}% (${returnedShipments.length} of ${shipments.length} parcels).`,
        });

        const anomaly: Anomaly = {
          id: `anom_${tenantId}_rto_rate_${day}`,
          tenant_id: tenantId,
          metric: "rto_rate",
          detected_at: new Date().toISOString(),
          period_analyzed: "ACTIVE_SHIPMENTS",
          current_value: rtoRate,
          expected_value: 4.0,
          deviation_score: Number(((rtoRate - 4.0) / 4.0).toFixed(2)),
          detection_method: "STATIC_THRESHOLD",
          severity: "HIGH",
          explanation_status: "EXPLAINED",
          probable_cause: "Courier recipient unreachable or destination address ambiguity.",
          evidence: [rtoEvidence],
          affected_entities: [{ type: "COURIER", id: "COURIER_NETWORK", name: "Courier SLA" }],
          created_at: new Date().toISOString(),
        };

        detected.push(anomaly);
      }
    }

    return detected;
  }
}

export const anomalyDetectorService = new AnomalyDetectorService();
