/**
 * CommerceOS Phase 4: Controlled Checkout & Order Draft Tools
 * Strict non-bypass of Commerce Core OrderService and Pricing Engine.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { OrderService } from "@/domains/orders/order.service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { PricingService } from "@/domains/pricing/pricing.service";
import { findDistrict } from "@/lib/bd-geography";
import { BadRequestError } from "@/lib/errors";

const CalculateCheckoutInputSchema = z.object({
  items: z
    .array(
      z.object({
        variant_id: z.string().describe("Product variant ID"),
        quantity: z.number().int().positive().default(1),
      })
    )
    .min(1),
  // The customer's district decides the zone; a zone can be given only when the district isn't known yet (no default)
  district: z.string().optional().describe("Delivery district, one of Bangladesh's 64"),
  delivery_zone: z.enum(["INSIDE_DHAKA", "OUTSIDE_DHAKA"]).optional(),
  coupon_code: z.string().optional(),
});

export class CalculateCheckoutTool implements IAgentTool<z.infer<typeof CalculateCheckoutInputSchema>> {
  public readonly name = "calculate_checkout";
  public readonly description = "Calculate order subtotal, the store's delivery fee and coupon discounts without creating an order.";
  public readonly category = "CHECKOUT";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = CalculateCheckoutInputSchema;
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
          items: { type: "array", description: "Array of variant IDs and quantities" },
          district: { type: "string", description: "Delivery district (preferred)" },
          delivery_zone: { type: "string", enum: ["INSIDE_DHAKA", "OUTSIDE_DHAKA"] },
          coupon_code: { type: "string" },
        },
        required: ["items"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  /**
   * The same authoritative pricing as order creation (PricingService). This used to price items itself, invent a
   * ৳1200 "DEMO-SKU" line when no variant matched, and turn a free-delivery setting of 0 into ৳60/৳120 (FX-30).
   */
  public async execute(context: RequestContext, input: z.infer<typeof CalculateCheckoutInputSchema>) {
    const place = input.district ? findDistrict(input.district) : undefined;
    if (input.district && !place) {
      throw new BadRequestError(`"${input.district}" isn't one of Bangladesh's 64 districts.`);
    }
    const zone = place?.zone ?? input.delivery_zone;
    if (!zone) {
      throw new BadRequestError("Ask for the delivery district before quoting a delivery charge.");
    }
    const pricing = await PricingService.calculateOrderPricing(context.tenant.id, input.items, zone, input.coupon_code);
    return {
      subtotal: pricing.subtotal,
      delivery_charge: pricing.shipping_total,
      delivery_zone: zone,
      district: place?.district,
      discount_amount: pricing.discount_total,
      grand_total: pricing.grand_total,
      currency: "BDT",
      items: pricing.items,
    };
  }
}

const CreateOrderDraftInputSchema = z.object({
  customer_name: z.string().describe("Customer full name"),
  customer_phone: z.string().describe("Customer phone number (e.g. 01712345678)"),
  address_line: z.string().describe("Delivery address street/area"),
  // The customer's district, as they stated it; the zone and charge follow from it (FX-36: this assumed "Chittagong")
  district: z.string().min(1).describe("Delivery district, one of Bangladesh's 64 (e.g. Dhaka, Sylhet, Cumilla)"),
  items: z
    .array(
      z.object({
        variant_id: z.string().describe("Product variant ID"),
        quantity: z.number().int().positive().default(1),
      })
    )
    .min(1),
  payment_method: z.enum(["COD", "BKASH", "NAGAD", "CARD"]).default("COD"),
  coupon_code: z.string().optional(),
  notes: z.string().optional(),
});

export class CreateOrderDraftTool implements IAgentTool<z.infer<typeof CreateOrderDraftInputSchema>> {
  public readonly name = "create_order_draft";
  public readonly description = "Prepare a controlled order draft in Commerce Core. Requires customer confirmation.";
  public readonly category = "CHECKOUT";
  public readonly riskLevel: ToolRiskLevel = "MEDIUM_RISK";
  public readonly requiredPermission = PERMISSIONS.ORDERS_CREATE;
  public readonly requiresConfirmation = true;
  public readonly schema = CreateOrderDraftInputSchema;
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
          customer_name: { type: "string" },
          customer_phone: { type: "string" },
          address_line: { type: "string" },
          district: { type: "string", description: "Delivery district, one of Bangladesh's 64" },
          items: { type: "array" },
          payment_method: { type: "string", enum: ["COD", "BKASH", "NAGAD", "CARD"] },
          coupon_code: { type: "string" },
        },
        required: ["customer_name", "customer_phone", "address_line", "district", "items"],
      },
      timeout_ms: 6000,
      idempotent: this.idempotent,
    };
  }

  public async execute(
    context: RequestContext,
    input: z.infer<typeof CreateOrderDraftInputSchema>,
    options?: { conversationId?: string; idempotencyKey?: string }
  ) {
    const parts = input.customer_name.trim().split(" ");
    const firstName = parts[0] || "Valued";
    const lastName = parts.slice(1).join(" ") || "Customer";

    const order = await OrderService.createOrder(context, {
      customer: {
        first_name: firstName,
        last_name: lastName,
        phone: input.customer_phone,
      },
      delivery_address: {
        district: input.district,
        address_line_1: input.address_line,
      },
      items: input.items,
      payment_method: input.payment_method,
      coupon_code: input.coupon_code,
      notes: input.notes ? `[AI Draft] ${input.notes}` : "[AI Drafted Order]",
      source: "SOCIAL",
    });

    return {
      order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      grand_total: order.grand_total,
      delivery_charge: order.shipping_total,
      currency: "BDT",
      payment_method: order.payment_method,
      message: `Order draft ${order.order_number} has been created with total ৳${order.grand_total}. Awaiting customer final confirmation.`,
    };
  }
}
