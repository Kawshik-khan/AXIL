/**
 * CommerceOS Phase 6: Risk Detection Engine
 * Proactive detection of stockout hazards, dead-stock capital locks, and delivery bottlenecks.
 */

import { db } from "@/infrastructure/db";
import { Risk } from "@/types/intelligence";
import { entitySetKey } from "@/lib/computed-rows";
import { evidenceService } from "./evidence.service";
import { inventoryIntelligenceService } from "./inventory-intelligence.service";
import { paymentIntelligenceService } from "./payment-intelligence.service";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class RiskDetectorService {
  /**
   * Scans operations for operational risks and stores them (one write, idempotent).
   */
  public detectRisks(tenantId: string): Risk[] {
    return intelligenceSnapshots.persist(tenantId, "risks", this.computeRisks(tenantId));
  }

  /** Pure (FX-21): risks with deterministic ids `risk_${tenant}_${kind}_${entity}`. */
  public computeRisks(tenantId: string): Risk[] {
    const risks: Risk[] = [];
    const inventory = inventoryIntelligenceService.computeInventoryHealth(tenantId);
    const payments = paymentIntelligenceService.analyzePayments(tenantId);

    // 1. Stockout Hazard
    const criticalStockouts = inventory.filter((i) => i.stockout_risk_level === "CRITICAL");
    for (const item of criticalStockouts) {
      const evidence = evidenceService.createEvidence({
        sourceType: "INVENTORY",
        sourceId: `inv_${item.variant_id}`,
        metric: "available_stock",
        value: item.available_stock,
        description: `Variant '${item.product_name}' has only ${item.available_stock} units remaining with estimated stockout in ${item.days_of_inventory_remaining} days.`,
      });

      const risk: Risk = {
        id: `risk_${tenantId}_stockout_${item.variant_id}`,
        tenant_id: tenantId,
        type: "STOCKOUT",
        title: `Imminent Stockout for '${item.product_name}'`,
        description: `Depletion of current stock will result in missed sales and lost customer goodwill.`,
        severity: item.available_stock <= 0 ? "CRITICAL" : "HIGH",
        probability: item.available_stock <= 0 ? 1.0 : 0.85,
        evidence: [evidence],
        affected_entities: [{ type: "VARIANT", id: item.variant_id, name: item.product_name }],
        recommended_mitigation: `Issue supplier restock PO for ${item.recommended_reorder_qty} units immediately.`,
        confidence: 0.95,
        created_at: new Date().toISOString(),
      };

      risks.push(risk);
    }

    // 2. Overstock / Dead Stock Hazard
    const deadStocks = inventory.filter((i) => i.is_dead_stock);
    if (deadStocks.length > 0) {
      const totalDeadUnits = deadStocks.reduce((sum, d) => sum + d.current_stock, 0);
      const evidence = evidenceService.createEvidence({
        sourceType: "INVENTORY",
        sourceId: `inv_dead_stock_${tenantId}`,
        metric: "dead_stock_units",
        value: totalDeadUnits,
        description: `${deadStocks.length} SKU(s) have generated zero sales in 30 days while holding ${totalDeadUnits} units.`,
      });

      const risk: Risk = {
        id: `risk_${tenantId}_overstock_${entitySetKey(deadStocks.map((d) => d.variant_id))}`,
        tenant_id: tenantId,
        type: "OVERSTOCK",
        title: `Capital Locked in ${deadStocks.length} Dead Stock SKU(s)`,
        description: `Unmoving inventory occupies warehouse capacity and ties up working capital.`,
        severity: "MEDIUM",
        probability: 0.75,
        evidence: [evidence],
        affected_entities: deadStocks.map((d) => ({ type: "VARIANT", id: d.variant_id, name: d.product_name })),
        recommended_mitigation: "Create a promotional bundle or clearance discount to liquidate idle units.",
        confidence: 0.9,
        created_at: new Date().toISOString(),
      };

      risks.push(risk);
    }

    // 3. Payment Gateway Disruption Hazard
    if (payments.failure_spike_detected) {
      const evidence = evidenceService.createEvidence({
        sourceType: "PAYMENT",
        sourceId: `payment_audit_${tenantId}`,
        metric: "overall_success_rate",
        value: `${payments.overall_success_rate_pct}%`,
        description: `Payment success rate dropped to ${payments.overall_success_rate_pct}% with elevated gateway rejection counts.`,
      });

      const risk: Risk = {
        id: `risk_${tenantId}_payment_gateway`,
        tenant_id: tenantId,
        type: "PAYMENT_GATEWAY_DOWN",
        title: "MFS Gateway Payment Rejection Elevated",
        description: "Customers may experience checkout drop-offs due to mobile financial service connectivity issues.",
        severity: "HIGH",
        probability: 0.8,
        evidence: [evidence],
        affected_entities: [{ type: "PAYMENT_SYSTEM", id: "MFS", name: "bKash/Nagad Rails" }],
        recommended_mitigation: "Enable COD fallback or notify customer support to offer manual TrxID verification.",
        confidence: 0.88,
        created_at: new Date().toISOString(),
      };

      risks.push(risk);
    }

    return risks;
  }
}

export const riskDetectorService = new RiskDetectorService();
