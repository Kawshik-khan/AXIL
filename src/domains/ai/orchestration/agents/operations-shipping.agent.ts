/**
 * CommerceOS Phase 5: Shipping & Logistics Agent
 * Handles delivery quotes, courier selection (Pathao/Steadfast), and transit tracking.
 */

import { BaseAgent } from "@/domains/ai/agents/base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";
import { RequestContext } from "@/lib/context";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { PricingService } from "@/domains/pricing/pricing.service";

export class ShippingAgent extends BaseAgent {
  public readonly agentType: AgentType = "SHIPPING";
  public readonly allowedTools: string[] = ["get_shipping_estimate", "track_shipment"];
  public readonly modelTier: ModelTier = "TIER_1_FAST";
  public override readonly maxIterations: number = 4;
  public override readonly timeoutMs: number = 12000;

  /**
   * Deterministic calculation of regional shipping charge in Bangladesh
   */
  public calculateEstimate(
    context: RequestContext,
    city: string,
    weightKg: number = 0.5
  ) {
    const isInsideDhaka =
      city.toLowerCase().includes("dhaka") || city.toLowerCase().includes("ঢাকা");
    // The tenant's delivery fees, not 60/130 literals (outside Dhaka was 130 here but 120 at checkout) (FX-31)
    const fees = PricingService.getDeliveryFees(context.tenant.id);
    const baseRate = isInsideDhaka ? fees.inside_dhaka_bdt : fees.outside_dhaka_bdt;
    const additionalWeight = Math.max(0, Math.ceil(weightKg - 1));
    const extraCharge = additionalWeight * (isInsideDhaka ? 20 : 25);
    const charge = baseRate + extraCharge;
    const estimatedDays = isInsideDhaka ? 1 : 3;

    return {
      charge,
      currency: "BDT",
      estimated_days: estimatedDays,
      // No courier is named: the tenant's courier isn't known here and the booking is manual (FX-31)
    };
  }
}

export const shippingAgent = new ShippingAgent();
