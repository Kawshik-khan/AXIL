import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Pricing Operations Service
 * Governed dynamic pricing optimization with strict profit margin safeguards,
 * single-step swing boundaries, pre-execution microeconomic simulation, and rollback support.
 */

import { db } from "@/infrastructure/db";
import {
  PricingRule,
  PricingRecommendation,
  PriceSimulation,
  PriceChangeRequest,
  PriceChangeExecution,
} from "@/types/operations";

export class PricingOperationsService {
  /**
   * Evaluates catalog prices against margin floors and inventory velocity to generate recommendations
   */
  public generatePricingRecommendations(tenantId: string): PricingRecommendation[] {
    const variants = db.getAllProductVariants(tenantId);
    const inventory = db.getInventory(tenantId);
    const rules = db.getPricingRules(tenantId).filter((r) => r.is_active);
    const minMarginPercent = rules.length > 0 ? Math.max(...rules.map((r) => r.min_margin_percent)) : 20;
    const recommendations: PricingRecommendation[] = [];

    const inventoryByVariant = new Map<string, (typeof inventory)[number]>(); // first row per variant, O(V + I) (FX-23)
    for (const i of inventory) if (!inventoryByVariant.has(i.product_variant_id)) inventoryByVariant.set(i.product_variant_id, i);

    for (const v of variants) {
      const inv = inventoryByVariant.get(v.id);
      const stock = inv ? inv.quantity_available : 0;
      const cost = v.cost_price || Math.round(v.price * 0.65); // Fallback cost estimate
      const currentMargin = ((v.price - cost) / v.price) * 100;

      // Scenario A: Overstock / Dead stock clearance (>60 units, margin allows discount)
      if (stock > 60 && currentMargin > minMarginPercent + 10) {
        const discountedPrice = Math.round(v.price * 0.88); // 12% discount
        const newMargin = ((discountedPrice - cost) / discountedPrice) * 100;

        if (newMargin >= minMarginPercent) {
          recommendations.push({
            id: `prec_${v.id}_clearance_${Date.now()}_${randomSuffix()}`,
            tenant_id: tenantId,
            product_variant_id: v.id,
            sku: v.sku,
            product_name: v.title,
            current_price: v.price,
            cost_price: cost,
            recommended_price: discountedPrice,
            reason: "OVERSTOCK",
            projected_margin_percent: Number(newMargin.toFixed(1)),
            projected_demand_delta_percent: 35,
            confidence: 0.92,
            status: "PENDING",
            created_at: new Date().toISOString(),
          });
        }
      }

      // Scenario B: Margin defense (price is below or near margin floor)
      if (currentMargin < minMarginPercent) {
        const safePrice = Math.ceil(cost / (1 - minMarginPercent / 100));
        recommendations.push({
          id: `prec_${v.id}_defense_${Date.now()}_${randomSuffix()}`,
          tenant_id: tenantId,
          product_variant_id: v.id,
          sku: v.sku,
          product_name: v.title,
          current_price: v.price,
          cost_price: cost,
          recommended_price: safePrice,
          reason: "MARGIN_DEFENSE",
          projected_margin_percent: minMarginPercent,
          projected_demand_delta_percent: -8,
          confidence: 0.95,
          status: "PENDING",
          created_at: new Date().toISOString(),
        });
      }
    }

    return recommendations;
  }

  /**
   * Pre-execution simulation: computes volume, revenue, and profit impact without modifying state
   */
  public simulatePriceChange(
    tenantId: string,
    variantId: string,
    proposedPrice: number
  ): PriceSimulation {
    const variant = db.findVariantById(tenantId, variantId);
    if (!variant) throw new AppError("NOT_FOUND", `Product variant not found: ${variantId}`, 404);

    const cost = variant.cost_price || Math.round(variant.price * 0.65);
    const currentPrice = variant.price;
    const currentMargin = ((currentPrice - cost) / currentPrice) * 100;
    const proposedMargin = ((proposedPrice - cost) / proposedPrice) * 100;

    const rules = db.getPricingRules(tenantId).filter((r) => r.is_active);
    const minMargin = rules.length > 0 ? Math.max(...rules.map((r) => r.min_margin_percent)) : 20;
    const maxChangePercent = rules.length > 0 ? Math.min(...rules.map((r) => r.max_price_change_percent)) : 25;

    const warnings: string[] = [];
    const priceDeltaPercent = Math.abs(((proposedPrice - currentPrice) / currentPrice) * 100);

    if (proposedMargin < minMargin) {
      warnings.push(`Proposed margin (${proposedMargin.toFixed(1)}%) breaches minimum policy floor (${minMargin}%).`);
    }

    if (priceDeltaPercent > maxChangePercent) {
      warnings.push(`Price swing of ${priceDeltaPercent.toFixed(1)}% exceeds maximum single-action boundary (${maxChangePercent}%).`);
    }

    // Microeconomic elasticity estimation (typical e-commerce price elasticity = -1.5)
    const elasticity = -1.5;
    const percentChange = (proposedPrice - currentPrice) / currentPrice;
    const expectedVolumeChangePercent = Number((percentChange * elasticity * 100).toFixed(1));

    const baseMonthlyVolume = 40; // baseline units
    const projectedVolume = Math.max(1, Math.round(baseMonthlyVolume * (1 + expectedVolumeChangePercent / 100)));
    const currentRevenue = baseMonthlyVolume * currentPrice;
    const projectedRevenue = projectedVolume * proposedPrice;
    const currentProfit = baseMonthlyVolume * (currentPrice - cost);
    const projectedProfit = projectedVolume * (proposedPrice - cost);

    return {
      variant_id: variantId,
      current_price: currentPrice,
      cost_price: cost,
      proposed_price: proposedPrice,
      current_margin_percent: Number(currentMargin.toFixed(1)),
      proposed_margin_percent: Number(proposedMargin.toFixed(1)),
      margin_safe: proposedMargin >= minMargin && priceDeltaPercent <= maxChangePercent,
      expected_volume_change_percent: expectedVolumeChangePercent,
      projected_revenue_impact_bdt: projectedRevenue - currentRevenue,
      projected_profit_impact_bdt: projectedProfit - currentProfit,
      warnings,
    };
  }

  /**
   * Submits a price change request through policy validation
   */
  public requestPriceChange(
    tenantId: string,
    params: {
      variantId: string;
      newPrice: number;
      reason: string;
      scheduledAt?: string;
    }
  ): PriceChangeRequest {
    const simulation = this.simulatePriceChange(tenantId, params.variantId, params.newPrice);
    const variant = db.findVariantById(tenantId, params.variantId)!;

    const requestId = `pcr_${Date.now()}_${randomSuffix()}`;
    const status: PriceChangeRequest["status"] = simulation.margin_safe ? "SCHEDULED" : "PENDING_APPROVAL";

    const request: PriceChangeRequest = {
      id: requestId,
      tenant_id: tenantId,
      product_variant_id: params.variantId,
      sku: variant.sku,
      old_price: variant.price,
      new_price: params.newPrice,
      margin_percent: simulation.proposed_margin_percent,
      reason: params.reason,
      scheduled_at: params.scheduledAt,
      status,
      created_at: new Date().toISOString(),
      rollback_price: variant.price,
    };

    return db.createPriceChangeRequest(request);
  }

  /**
   * Executes an approved or scheduled price change in Commerce Core
   */
  public executePriceChange(
    tenantId: string,
    requestId: string,
    actor: string
  ): PriceChangeExecution {
    const request = db.getPriceChangeRequests(tenantId).find((r) => r.id === requestId);
    if (!request) throw new AppError("NOT_FOUND", `Price change request not found: ${requestId}`, 404);

    const variant = db.findVariantById(tenantId, request.product_variant_id);
    if (!variant) throw new AppError("NOT_FOUND", `Product variant not found: ${request.product_variant_id}`, 404);

    const oldPrice = variant.price;
    // Mutate via authoritative DB store
    db.updateProductVariant(tenantId, variant.id, { price: request.new_price });

    const auditId = `aud_price_${Date.now()}_${randomSuffix()}`;
    db.createAuditLog({
      id: auditId,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "PRICE_CHANGED",
      resource_type: "product_variant",
      resource_id: variant.id,
      metadata: { old_price: oldPrice, new_price: request.new_price, request_id: request.id },
      created_at: new Date().toISOString(),
    });

    const execution: PriceChangeExecution = {
      id: `pce_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      request_id: request.id,
      product_variant_id: variant.id,
      old_price: oldPrice,
      new_price: request.new_price,
      executed_at: new Date().toISOString(),
      status: "SUCCESS",
      rollback_price: oldPrice,
      audit_id: auditId,
    };

    db.recordPriceChangeExecution(execution);
    db.updatePriceChangeRequest(tenantId, request.id, {
      status: "EXECUTED",
      executed_at: execution.executed_at,
    });

    return execution;
  }

  /**
   * Rolls back an executed price change
   */
  public rollbackPriceChange(
    tenantId: string,
    executionId: string,
    actor: string
  ): PriceChangeExecution {
    const execution = db.getPriceChangeExecutions(tenantId).find((e) => e.id === executionId);
    if (!execution || !execution.rollback_price) {
      throw new AppError("NOT_FOUND", `Valid execution or rollback price not found for: ${executionId}`, 404);
    }

    db.updateProductVariant(tenantId, execution.product_variant_id, { price: execution.rollback_price });

    db.createAuditLog({
      id: `aud_price_rollback_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "PRICE_ROLLED_BACK",
      resource_type: "product_variant",
      resource_id: execution.product_variant_id,
      metadata: { restored_price: execution.rollback_price, execution_id: executionId },
      created_at: new Date().toISOString(),
    });

    execution.status = "ROLLED_BACK";
    execution.rolled_back_at = new Date().toISOString();
    return execution;
  }
}

export const pricingOperationsService = new PricingOperationsService();
