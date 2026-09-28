/**
 * CommerceOS Phase 4: Shipping & Courier Tools
 * Grounded in Commerce Core Delivery Rules (৳60 / ৳120) & Courier Tracking.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { PricingService } from "@/domains/pricing/pricing.service";

const GetShipmentStatusInputSchema = z.object({
  tracking_code: z.string().describe("Courier tracking code or consignment ID"),
});

export class GetShipmentStatusTool implements IAgentTool<z.infer<typeof GetShipmentStatusInputSchema>> {
  public readonly name = "get_shipment_status";
  public readonly description = "Retrieve authoritative courier shipment tracking and delivery timeline.";
  public readonly category = "SHIPPING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.SHIPMENTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetShipmentStatusInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          tracking_code: { type: "string", description: "Consignment tracking code" },
        },
        required: ["tracking_code"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetShipmentStatusInputSchema>) {
    const shipments = db.getShipments(context.tenant.id);
    const shipment = shipments.find(
      (s) =>
        s.tracking_number?.toLowerCase() === input.tracking_code.toLowerCase() ||
        s.order_id?.toLowerCase() === input.tracking_code.toLowerCase()
    );

    if (!shipment) {
      return {
        found: false,
        tracking_code: input.tracking_code,
        message: `No shipment found matching tracking code '${input.tracking_code}'.`,
      };
    }

    return {
      found: true,
      tracking_code: shipment.tracking_number,
      courier_name: shipment.courier_provider,
      status: shipment.status,
      delivery_charge: shipment.shipping_cost,
      currency: "BDT",
      created_at: shipment.created_at,
      dispatched_at: shipment.shipped_at,
      delivered_at: shipment.delivered_at,
    };
  }
}

const GetShippingEstimateInputSchema = z.object({
  delivery_zone: z.enum(["INSIDE_DHAKA", "OUTSIDE_DHAKA"]).describe("Destination zone"),
});

export class GetShippingEstimateTool implements IAgentTool<z.infer<typeof GetShippingEstimateInputSchema>> {
  public readonly name = "get_shipping_estimate";
  public readonly description = "Get authoritative delivery rate and estimated time for Inside/Outside Dhaka.";
  public readonly category = "SHIPPING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.SETTINGS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetShippingEstimateInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          delivery_zone: { type: "string", enum: ["INSIDE_DHAKA", "OUTSIDE_DHAKA"], description: "Destination zone" },
        },
        required: ["delivery_zone"],
      },
      timeout_ms: 2000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetShippingEstimateInputSchema>) {
    // `|| 60` turned a free-delivery setting of 0 into 60; getDeliveryFees only defaults when unset (FX-31)
    const fees = PricingService.getDeliveryFees(context.tenant.id);
    const chargeInside = fees.inside_dhaka_bdt;
    const chargeOutside = fees.outside_dhaka_bdt;

    const isInside = input.delivery_zone === "INSIDE_DHAKA";
    return {
      delivery_zone: input.delivery_zone,
      delivery_charge: isInside ? chargeInside : chargeOutside,
      currency: "BDT",
      estimated_days: isInside ? "1-2 business days" : "2-4 business days",
    };
  }
}
