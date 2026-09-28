/**
 * CommerceOS Phase 4: Order & Tracking Tools
 * Grounded in Commerce Core OrderService & ShipmentService.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { OrderService } from "@/domains/orders/order.service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

const GetOrderInputSchema = z.object({
  order_number: z.string().describe("Order identifier, e.g. COM-2026-000123 or ORD-123"),
});

export class GetOrderTool implements IAgentTool<z.infer<typeof GetOrderInputSchema>> {
  public readonly name = "get_order";
  public readonly description = "Retrieve sanitized order details for an existing customer order. Never fabricates orders.";
  public readonly category = "ORDER";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ORDERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetOrderInputSchema;
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
          order_number: { type: "string", description: "Order number (e.g. COM-2026-000123)" },
        },
        required: ["order_number"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetOrderInputSchema>) {
    const order = await OrderService.findOrderByReference(context, input.order_number); // every order, not the newest 50

    if (!order) {
      return {
        found: false,
        order_number: input.order_number,
        message: `Order '${input.order_number}' could not be found in our records. Please verify the number.`,
      };
    }

    const items = db.getOrderItems(context.tenant.id, order.id);
    const shipments = db.getShipments(context.tenant.id, order.id);
    const latestShipment = shipments[0];

    const isInsideDhaka =
      order.shipping_address_snapshot?.district?.toLowerCase() === "dhaka" ||
      order.shipping_address_snapshot?.division?.toLowerCase() === "dhaka";

    return {
      found: true,
      order_number: order.order_number,
      status: order.status,
      payment_status: order.payment_status,
      fulfillment_status: order.fulfillment_status,
      total_amount: order.grand_total,
      currency: "BDT",
      created_at: order.created_at,
      item_count: items.length,
      items: items.map((i) => ({
        product_name: i.product_name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
        price: i.unit_price,
      })),
      shipping: {
        zone: isInsideDhaka ? "INSIDE_DHAKA" : "OUTSIDE_DHAKA",
        courier: latestShipment?.courier_provider || "Assigned during dispatch",
        tracking_code: latestShipment?.tracking_number,
        status: latestShipment?.status || "PENDING",
      },
    };
  }
}

const GetOrderStatusInputSchema = z.object({
  order_number: z.string().describe("Order tracking code or order number"),
});

export class GetOrderStatusTool implements IAgentTool<z.infer<typeof GetOrderStatusInputSchema>> {
  public readonly name = "get_order_status";
  public readonly description = "Fast query of order lifecycle status, courier delivery progress, and shipment state.";
  public readonly category = "ORDER";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ORDERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetOrderStatusInputSchema;
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
          order_number: { type: "string", description: "Order tracking code or number" },
        },
        required: ["order_number"],
      },
      timeout_ms: 3500,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetOrderStatusInputSchema>) {
    const order = await OrderService.findOrderByReference(context, input.order_number); // every order, not the newest 50

    if (!order) {
      return {
        found: false,
        order_number: input.order_number,
        status: "UNKNOWN",
        message: `Order '${input.order_number}' was not found. Please double check the order number.`,
      };
    }

    const shipments = db.getShipments(context.tenant.id, order.id);
    const shipment = shipments[0];

    const isInsideDhaka =
      order.shipping_address_snapshot?.district?.toLowerCase() === "dhaka" ||
      order.shipping_address_snapshot?.division?.toLowerCase() === "dhaka";

    return {
      found: true,
      order_number: order.order_number,
      status: order.status,
      payment_status: order.payment_status,
      shipment_status: shipment?.status || "PROCESSING",
      courier_name: shipment?.courier_provider || "Steadfast Courier",
      courier_tracking_code: shipment?.tracking_number || "STF-2026-PENDING",
      estimated_delivery: isInsideDhaka
        ? "Within 24-48 hours (Dhaka Metro)"
        : "Within 2-4 business days (Outside Dhaka)",
    };
  }
}
