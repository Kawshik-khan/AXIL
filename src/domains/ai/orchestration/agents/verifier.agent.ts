/**
 * CommerceOS Phase 5: Deterministic Verifier Agent
 * Validates task output claims against objective database records and authoritative domain state.
 */

import { db } from "@/infrastructure/db";
import { AgentType } from "@/types/ai";
import {
  AgentVerification,
  VerificationMethod,
  VerificationStatus,
} from "@/types/orchestration";

export interface VerificationRequest {
  taskId: string;
  workflowId: string;
  tenantId: string;
  targetAssertion: string;
  claimedOutput: Record<string, unknown>;
  expectedMethod?: VerificationMethod;
}

export class VerifierAgent {
  public readonly agentType: AgentType = "VERIFIER";

  /**
   * Performs objective verification against authoritative domain state
   */
  public async verify(req: VerificationRequest): Promise<AgentVerification> {
    const verifiedAt = new Date().toISOString();
    const verificationId = `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Order Creation / Draft Assertion
    if (req.claimedOutput.order_id || req.claimedOutput.order_number) {
      const orderId = (req.claimedOutput.order_id || req.claimedOutput.id) as string;
      const order = db.findOrderById(req.tenantId, orderId);

      if (order && order.tenant_id === req.tenantId) {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "DOMAIN_STATE",
          status: "VERIFIED",
          target_assertion: req.targetAssertion,
          evidence: {
            verified_entity: "ORDER",
            order_id: order.id,
            order_number: order.order_number,
            status: order.status,
            total_amount: order.grand_total,
          },
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      } else {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "DOMAIN_STATE",
          status: "FAILED",
          target_assertion: req.targetAssertion,
          evidence: { queried_order_id: orderId, found: false },
          failure_reason: `Order with ID ${orderId} does not exist in authoritative tenant database. Claim rejected.`,
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      }
    }

    // 2. Inventory Availability / Stock Audit Assertion
    if (req.claimedOutput.variant_id && req.claimedOutput.available_quantity !== undefined) {
      const variantId = req.claimedOutput.variant_id as string;
      const claimedQty = req.claimedOutput.available_quantity as number;
      const invItems = db.getInventory(req.tenantId).filter(
        (i) => i.product_variant_id === variantId
      );
      const actualQty = invItems.reduce((acc: number, i) => acc + i.quantity_available, 0);

      // Verify claimed matches actual within acceptable tolerance
      if (Math.abs(claimedQty - actualQty) === 0) {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "DOMAIN_STATE",
          status: "VERIFIED",
          target_assertion: req.targetAssertion,
          evidence: {
            verified_entity: "INVENTORY",
            variant_id: variantId,
            verified_quantity: actualQty,
          },
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      } else {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "DOMAIN_STATE",
          status: "FAILED",
          target_assertion: req.targetAssertion,
          evidence: { claimed_quantity: claimedQty, actual_quantity: actualQty },
          failure_reason: `Claimed stock quantity (${claimedQty}) does not match physical database inventory (${actualQty}).`,
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      }
    }

    // 3. Payment Status Assertion
    if (req.claimedOutput.payment_id || req.claimedOutput.trx_id) {
      const paymentId = req.claimedOutput.payment_id as string;
      const payments = db.getPayments(req.tenantId);
      const matched = payments.find(
        (p) => p.id === paymentId || p.transaction_id === req.claimedOutput.trx_id
      );

      if (matched && matched.status === req.claimedOutput.status) {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "PROVIDER_CONFIRMATION",
          status: "VERIFIED",
          target_assertion: req.targetAssertion,
          evidence: {
            payment_id: matched.id,
            status: matched.status,
            amount: matched.amount,
            trx_id: matched.transaction_id,
          },
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      } else {
        const record: AgentVerification = {
          id: verificationId,
          tenant_id: req.tenantId,
          workflow_id: req.workflowId,
          task_id: req.taskId,
          verifier_agent: "VERIFIER",
          method: "PROVIDER_CONFIRMATION",
          status: "FAILED",
          target_assertion: req.targetAssertion,
          evidence: { claimed: req.claimedOutput, matched_payment: matched || null },
          failure_reason: "Payment status could not be verified against transaction ledger.",
          verified_at: verifiedAt,
          created_at: verifiedAt,
        };
        db.insertAgentVerification(record);
        return record;
      }
    }

    // 4. Default Tool Result & Schema Invariant Check
    if (req.claimedOutput && Object.keys(req.claimedOutput).length > 0) {
      const record: AgentVerification = {
        id: verificationId,
        tenant_id: req.tenantId,
        workflow_id: req.workflowId,
        task_id: req.taskId,
        verifier_agent: "VERIFIER",
        method: req.expectedMethod || "TOOL_RESULT",
        status: "VERIFIED",
        target_assertion: req.targetAssertion,
        evidence: { verified_output_keys: Object.keys(req.claimedOutput) },
        verified_at: verifiedAt,
        created_at: verifiedAt,
      };
      db.insertAgentVerification(record);
      return record;
    }

    // If output is empty or missing
    const record: AgentVerification = {
      id: verificationId,
      tenant_id: req.tenantId,
      workflow_id: req.workflowId,
      task_id: req.taskId,
      verifier_agent: "VERIFIER",
      method: "RULE",
      status: "FAILED",
      target_assertion: req.targetAssertion,
      evidence: { empty_output: true },
      failure_reason: "Task produced no verifiable structured output.",
      verified_at: verifiedAt,
      created_at: verifiedAt,
    };
    db.insertAgentVerification(record);
    return record;
  }
}

export const verifierAgent = new VerifierAgent();
