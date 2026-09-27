/**
 * CommerceOS Phase 5: Payment & Settlement Agent
 * Verifies transaction IDs, reconciles invoices, and computes refund eligibility.
 */

import { BaseAgent } from "@/domains/ai/agents/base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";
import { RequestContext } from "@/lib/context";
import { db } from "@/infrastructure/db";

export class PaymentAgent extends BaseAgent {
  public readonly agentType: AgentType = "PAYMENT";
  public readonly allowedTools: string[] = ["check_payment_status"];
  public readonly modelTier: ModelTier = "TIER_1_FAST";
  public override readonly maxIterations: number = 4;
  public override readonly timeoutMs: number = 12000;

  /**
   * Deterministic payment verification from database records
   */
  public verifyPayment(
    context: RequestContext,
    paymentId: string
  ): { verified: boolean; status: string; amount: number; method: string } | null {
    const payment = db.findPaymentById(context.tenant.id, paymentId);
    if (!payment) {
      return null;
    }

    return {
      verified: payment.status === "PAID",
      status: payment.status,
      amount: payment.amount,
      method: payment.provider,
    };
  }
}

export const paymentAgent = new PaymentAgent();
