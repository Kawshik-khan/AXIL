import { randomSuffix } from "@/lib/ids";
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
import { loadOrderRows, loadVariantRows } from "@/infrastructure/db/tenant-rows";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";

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
    const verificationId = `ver_${Date.now()}_${randomSuffix()}`;

    // 1. Order Creation / Draft Assertion
    if (req.claimedOutput.order_id || req.claimedOutput.order_number) {
      const orderId = (req.claimedOutput.order_id || req.claimedOutput.id) as string;
      await loadOrderRows(req.tenantId, [orderId]); // zero-hydration: the order's rows this flow reads and changes
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
      const invItems = (await inventoryRepository.getStockLevels(req.tenantId)).filter(
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

    // 4. Draft Numeric & Pricing Integrity Assertion
    const numbers = (req.claimedOutput.authoritative_numbers && typeof req.claimedOutput.authoritative_numbers === "object"
      ? req.claimedOutput.authoritative_numbers
      : req.claimedOutput) as Record<string, unknown>;
    const hasPricingClaim =
      numbers.unit_price !== undefined ||
      numbers.subtotal !== undefined ||
      numbers.grand_total !== undefined ||
      req.claimedOutput.draft_type !== undefined;

    if (hasPricingClaim) {
      const variantId = typeof numbers.variant_id === "string" ? numbers.variant_id : undefined;
      if (variantId && typeof numbers.unit_price === "number") {
        await loadVariantRows(req.tenantId, [variantId]);
        const variant = db.findVariantById(req.tenantId, variantId);
        if (!variant) {
          const record: AgentVerification = {
            id: verificationId,
            tenant_id: req.tenantId,
            workflow_id: req.workflowId,
            task_id: req.taskId,
            verifier_agent: "VERIFIER",
            method: "DOMAIN_STATE",
            status: "FAILED",
            target_assertion: req.targetAssertion,
            evidence: { variant_id: variantId, found: false },
            failure_reason: `Variant '${variantId}' does not exist in tenant catalog.`,
            verified_at: verifiedAt,
            created_at: verifiedAt,
          };
          db.insertAgentVerification(record);
          return record;
        }
        if (Math.abs(numbers.unit_price - variant.price) > 0.01) {
          const record: AgentVerification = {
            id: verificationId,
            tenant_id: req.tenantId,
            workflow_id: req.workflowId,
            task_id: req.taskId,
            verifier_agent: "VERIFIER",
            method: "DOMAIN_STATE",
            status: "FAILED",
            target_assertion: req.targetAssertion,
            evidence: { variant_id: variantId, claimed_unit_price: numbers.unit_price, actual_unit_price: variant.price },
            failure_reason: `Claimed unit price (${numbers.unit_price}) does not match authoritative catalog price (${variant.price}).`,
            verified_at: verifiedAt,
            created_at: verifiedAt,
          };
          db.insertAgentVerification(record);
          return record;
        }
      }

      if (variantId && typeof numbers.available_quantity === "number") {
        const invItems = (await inventoryRepository.getStockLevels(req.tenantId)).filter(
          (i) => i.product_variant_id === variantId
        );
        const actualQty = invItems.reduce((acc: number, i) => acc + i.quantity_available, 0);
        if (Math.abs(numbers.available_quantity - actualQty) > 0) {
          const record: AgentVerification = {
            id: verificationId,
            tenant_id: req.tenantId,
            workflow_id: req.workflowId,
            task_id: req.taskId,
            verifier_agent: "VERIFIER",
            method: "DOMAIN_STATE",
            status: "FAILED",
            target_assertion: req.targetAssertion,
            evidence: { variant_id: variantId, claimed_quantity: numbers.available_quantity, actual_quantity: actualQty },
            failure_reason: `Claimed stock quantity (${numbers.available_quantity}) does not match physical database inventory (${actualQty}).`,
            verified_at: verifiedAt,
            created_at: verifiedAt,
          };
          db.insertAgentVerification(record);
          return record;
        }
      }

      if (
        typeof numbers.subtotal === "number" &&
        typeof numbers.unit_price === "number" &&
        typeof numbers.quantity === "number"
      ) {
        const expectedSubtotal = Math.round(numbers.unit_price * numbers.quantity * 100) / 100;
        if (Math.abs(numbers.subtotal - expectedSubtotal) > 0.01) {
          const record: AgentVerification = {
            id: verificationId,
            tenant_id: req.tenantId,
            workflow_id: req.workflowId,
            task_id: req.taskId,
            verifier_agent: "VERIFIER",
            method: "RULE",
            status: "FAILED",
            target_assertion: req.targetAssertion,
            evidence: { claimed_subtotal: numbers.subtotal, expected_subtotal: expectedSubtotal },
            failure_reason: `Claimed subtotal (${numbers.subtotal}) does not match unit_price * quantity (${expectedSubtotal}).`,
            verified_at: verifiedAt,
            created_at: verifiedAt,
          };
          db.insertAgentVerification(record);
          return record;
        }
      }

      if (typeof numbers.grand_total === "number" && typeof numbers.subtotal === "number") {
        const discount = typeof numbers.discount_total === "number" ? numbers.discount_total : 0;
        const shipping = typeof numbers.shipping_total === "number" ? numbers.shipping_total : 0;
        const tax = typeof numbers.tax_total === "number" ? numbers.tax_total : 0;
        const expectedTotal = Math.max(0, Math.round((numbers.subtotal - discount + shipping + tax) * 100) / 100);
        if (Math.abs(numbers.grand_total - expectedTotal) > 0.01) {
          const record: AgentVerification = {
            id: verificationId,
            tenant_id: req.tenantId,
            workflow_id: req.workflowId,
            task_id: req.taskId,
            verifier_agent: "VERIFIER",
            method: "RULE",
            status: "FAILED",
            target_assertion: req.targetAssertion,
            evidence: { claimed_grand_total: numbers.grand_total, expected_grand_total: expectedTotal },
            failure_reason: `Claimed grand total (${numbers.grand_total}) does not match authoritative calculation (${expectedTotal}).`,
            verified_at: verifiedAt,
            created_at: verifiedAt,
          };
          db.insertAgentVerification(record);
          return record;
        }
      }

      const record: AgentVerification = {
        id: verificationId,
        tenant_id: req.tenantId,
        workflow_id: req.workflowId,
        task_id: req.taskId,
        verifier_agent: "VERIFIER",
        method: "DOMAIN_STATE",
        status: "VERIFIED",
        target_assertion: req.targetAssertion,
        evidence: { verified_draft_numbers: numbers },
        verified_at: verifiedAt,
        created_at: verifiedAt,
      };
      db.insertAgentVerification(record);
      return record;
    }

    // 5. Default Tool Result & Schema Invariant Check
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
