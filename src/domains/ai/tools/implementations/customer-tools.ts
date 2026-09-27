/**
 * CommerceOS Phase 4: Customer Query Tools
 * Strictly tenant-isolated and customer-isolated.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

const GetCustomerInputSchema = z.object({
  customer_id: z.string().describe("Canonical customer ID"),
});

export class GetCustomerTool implements IAgentTool<z.infer<typeof GetCustomerInputSchema>> {
  public readonly name = "get_customer";
  public readonly description = "Retrieve customer profile summary for the current conversation customer.";
  public readonly category = "CUSTOMER";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.CUSTOMERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetCustomerInputSchema;
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
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetCustomerInputSchema>) {
    const customer = db.findCustomerById(context.tenant.id, input.customer_id);
    if (!customer) {
      return { found: false, message: "Customer profile not found." };
    }

    return {
      found: true,
      id: customer.id,
      name: `${customer.first_name} ${customer.last_name}`,
      phone: customer.phone.slice(0, 4) + "..." + customer.phone.slice(-3), // Safe PII masking
      total_orders: customer.total_orders,
      total_spent: customer.total_spent,
      currency: "BDT",
      status: customer.status,
    };
  }
}

const GetCustomerOrdersInputSchema = z.object({
  customer_id: z.string().describe("Canonical customer ID"),
  limit: z.number().int().min(1).max(10).default(5),
});

export class GetCustomerOrdersTool implements IAgentTool<z.infer<typeof GetCustomerOrdersInputSchema>> {
  public readonly name = "get_customer_orders";
  public readonly description = "Retrieve recent orders placed by the current customer.";
  public readonly category = "CUSTOMER";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ORDERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetCustomerOrdersInputSchema;
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
          customer_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["customer_id"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetCustomerOrdersInputSchema>) {
    const orders = db.getOrders(context.tenant.id, {
      customer_id: input.customer_id,
      limit: input.limit,
    }).orders;

    return orders.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      payment_status: o.payment_status,
      grand_total: o.grand_total,
      created_at: o.created_at,
    }));
  }
}
