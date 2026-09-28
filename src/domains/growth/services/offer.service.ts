/**
 * CommerceOS Phase 7: Offer & Promotion Intelligence Service
 * Evaluates promotional discount rules, enforces margin guardrails, and simulates unit economics.
 */

import { db } from "@/infrastructure/db";
import { GrowthOffer, OfferSimulationResult } from "@/types/growth";
import { simulationService } from "@/domains/intelligence/services/simulation.service";
import { PricingService } from "@/domains/pricing/pricing.service";
import { COGS_FALLBACK_RATIO } from "@/domains/analytics/analytics.service";

export class OfferService {
  /**
   * Creates an offer with validation
   */
  public createOffer(offer: GrowthOffer): GrowthOffer {
    if (offer.value <= 0) {
      throw new Error("Offer value must be greater than zero.");
    }
    if (offer.type === "PERCENTAGE" && offer.value > 50) {
      throw new Error("Unbounded percentage discounts above 50% require explicit leadership approval.");
    }
    db.insertOffer(offer);
    return offer;
  }

  /**
   * Simulates the financial and margin impact of an offer before broad activation
   */
  public simulateOffer(tenantId: string, offer: GrowthOffer): OfferSimulationResult {
    // The shop's own average order value; no invented ৳1,500 or divide-by-at-least-10 (FX-30)
    const orders = db.getAllOrders(tenantId).filter((o) => o.status !== "CANCELLED");
    const avgOrderVal = orders.length > 0 ? orders.reduce((sum, o) => sum + (o.grand_total || 0), 0) / orders.length : null;
    const deliveryFee = PricingService.getDeliveryFees(tenantId).outside_dhaka_bdt;
    const assumptions = [
      `Cost of goods is taken as ${Math.round(COGS_FALLBACK_RATIO * 100)}% of revenue (no per-offer cost model).`,
      "Order volume comes from the price-elasticity simulation, not from past offers.",
    ];

    // Run what-if elasticity simulation via Phase 6
    const discountPct = offer.type === "PERCENTAGE"
      ? offer.value
      : offer.type === "FIXED_AMOUNT"
      ? avgOrderVal
        ? (offer.value / avgOrderVal) * 100
        : 0
      : avgOrderVal
      ? (deliveryFee / avgOrderVal) * 100 // free shipping = the delivery charge the shop gives up
      : 0;

    const sim = simulationService.simulateScenario(
      tenantId,
      `Offer Sim: ${offer.code}`,
      {
        price_change_pct: 0,
        discount_rate_change_pct: discountPct,
        time_horizon_days: 30,
      },
      "CUSTOM"
    );

    const projectedGrossRev = sim.simulated_metrics.revenue;
    const projectedOrders = sim.simulated_metrics.orders;

    // Calculate discount cost
    let avgDiscountPerOrder = 0;
    if (offer.type === "PERCENTAGE") {
      avgDiscountPerOrder = ((avgOrderVal ?? 0) * offer.value) / 100;
      if (offer.rules.max_discount_bdt) {
        avgDiscountPerOrder = Math.min(avgDiscountPerOrder, offer.rules.max_discount_bdt);
      }
    } else if (offer.type === "FIXED_AMOUNT") {
      avgDiscountPerOrder = offer.value;
    } else if (offer.type === "FREE_SHIPPING") {
      avgDiscountPerOrder = deliveryFee; // the shop's outside-Dhaka delivery charge (was an invented ৳100)
    }

    const projectedDiscountCost = Math.round(projectedOrders * avgDiscountPerOrder);
    const estimatedCOGS = Math.round(projectedGrossRev * COGS_FALLBACK_RATIO);
    const projectedNetMargin = Math.round(projectedGrossRev - estimatedCOGS - projectedDiscountCost);
    const netMarginPct = projectedGrossRev > 0 ? (projectedNetMargin / projectedGrossRev) * 100 : 0;

    const marginSafe = netMarginPct >= 15; // Requires at least 15% net margin
    let riskWarning: string | undefined;

    if (avgOrderVal === null) {
      riskWarning = "No order history yet, so the offer's impact can't be simulated.";
    } else if (!marginSafe) {
      riskWarning = `Compressed net margin (${netMarginPct.toFixed(1)}%). Offer cost ৳${projectedDiscountCost} degrades target baseline profitability.`;
    }

    return {
      offer_id: offer.id,
      estimated_redemption_rate_pct: null,
      estimated_order_volume: projectedOrders,
      projected_gross_revenue_bdt: projectedGrossRev,
      projected_discount_cost_bdt: projectedDiscountCost,
      projected_net_margin_bdt: projectedNetMargin,
      margin_safe: marginSafe,
      risk_warning: riskWarning,
      assumptions,
    };
  }

  /**
   * Applies an offer to a customer cart/order with eligibility verification
   */
  public validateOfferEligibility(params: {
    tenantId: string;
    offerCode: string;
    customerId: string;
    cartTotalBdt: number;
    cartCategoryIds?: string[];
  }): { eligible: boolean; discountAmountBdt: number; reason?: string } {
    const { tenantId, offerCode, customerId, cartTotalBdt } = params;

    const offer = db.getOffers(tenantId).find((o) => o.code === offerCode && o.is_active);
    if (!offer) {
      return { eligible: false, discountAmountBdt: 0, reason: "Offer is not active or does not exist." };
    }

    const now = new Date();
    if (now < new Date(offer.starts_at) || now > new Date(offer.expires_at)) {
      return { eligible: false, discountAmountBdt: 0, reason: "Offer has expired or is not yet active." };
    }

    if (offer.rules.min_cart_value_bdt && cartTotalBdt < offer.rules.min_cart_value_bdt) {
      return {
        eligible: false,
        discountAmountBdt: 0,
        reason: `Minimum cart value of ৳${offer.rules.min_cart_value_bdt} required (Current: ৳${cartTotalBdt}).`,
      };
    }

    // Customer usage check
    const usages = db.getOfferUsages(tenantId, offer.id).filter(
      (u) => u.customer_id === customerId
    );
    if (offer.rules.max_usages_per_customer && usages.length >= offer.rules.max_usages_per_customer) {
      return {
        eligible: false,
        discountAmountBdt: 0,
        reason: `Usage limit of ${offer.rules.max_usages_per_customer} exceeded for this customer.`,
      };
    }

    // Compute discount
    let discount = 0;
    if (offer.type === "PERCENTAGE") {
      discount = Math.round((cartTotalBdt * offer.value) / 100);
      if (offer.rules.max_discount_bdt) {
        discount = Math.min(discount, offer.rules.max_discount_bdt);
      }
    } else if (offer.type === "FIXED_AMOUNT") {
      discount = Math.min(offer.value, cartTotalBdt);
    } else if (offer.type === "FREE_SHIPPING") {
      discount = 120; // shipping waiver
    }

    return { eligible: true, discountAmountBdt: discount };
  }
}

export const offerService = new OfferService();
