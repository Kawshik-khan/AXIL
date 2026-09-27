/**
 * CommerceOS Phase 4: Payment Verification Tools
 * Grounded in Commerce Core PaymentService. Never fabricates payment confirmations.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

const GetPaymentStatusInputSchema = z.object({
  order_number: z.string().optional().describe("Associated order number"),
  transaction_id: z.string().optional().describe("bKash/Nagad TrxID or gateway reference"),
});

export class GetPaymentStatusTool implements IAgentTool<z.infer<typeof GetPaymentStatusInputSchema>> {
  public readonly name = "get_payment_status";
  public readonly description = "Verify authoritative payment status (bKash/Nagad/COD). Never invents payment confirmations.";
  public readonly category = "PAYMENT";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PAYMENTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetPaymentStatusInputSchema;
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
          order_number: { type: "string", description: "Order number" },
          transaction_id: { type: "string", description: "MFS TrxID" },
        },
        required: [],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetPaymentStatusInputSchema>) {
    let matchedPayment = undefined;

    if (input.order_number) {
      const orders = db.getOrders(context.tenant.id, { search: input.order_number }).orders;
      const order = orders.find(
        (o) => o.order_number.toLowerCase() === input.order_number?.toLowerCase()
      );
      if (order) {
        const payments = db.getPayments(context.tenant.id, order.id);
        matchedPayment = payments[0];
      }
    }

    if (!matchedPayment && input.transaction_id) {
      const payments = db.getPayments(context.tenant.id);
      matchedPayment = payments.find(
        (p) => p.transaction_id?.toLowerCase() === input.transaction_id?.toLowerCase()
      );
    }

    if (!matchedPayment) {
      return {
        found: false,
        status: "UNVERIFIED",
        message: "No payment record found matching the provided reference. Verification requires manual support.",
        requires_human: true,
      };
    }

    return {
      found: true,
      payment_id: matchedPayment.id,
      amount: matchedPayment.amount,
      currency: "BDT",
      provider: matchedPayment.provider,
      status: matchedPayment.status,
      transaction_id: matchedPayment.transaction_id,
      created_at: matchedPayment.created_at,
      message:
        matchedPayment.status === "PAID"
          ? "Payment has been received and verified successfully."
          : matchedPayment.status === "PENDING"
          ? "Payment is pending verification or awaiting COD collection upon delivery."
          : "Payment failed or was cancelled.",
    };
  }
}
