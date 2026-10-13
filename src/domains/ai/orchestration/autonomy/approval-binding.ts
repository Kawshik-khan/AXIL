import { createHash } from "crypto";
import { AgentTask, ApprovalRequest } from "@/types/orchestration";
import { db } from "@/infrastructure/db";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function approvalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function approvalPayloadDigest(tenantId: string, task: AgentTask): string {
  return approvalDigest({
    tenant_id: tenantId,
    workflow_id: task.workflow_id,
    task_id: task.id,
    action: task.task_type,
    risk_level: task.risk_level,
    input: task.input,
  });
}

/** Only targets with an authoritative versioned snapshot may enter the current approval path. */
export function captureApprovalTargetState(tenantId: string, entityType: string, entityId: string): Record<string, unknown> | undefined {
  if (entityType !== "ORDER") return undefined;
  const order = db.findOrderById(tenantId, entityId);
  if (!order) return undefined;
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    currency: order.currency,
    subtotal: order.subtotal,
    discount_total: order.discount_total,
    shipping_total: order.shipping_total,
    tax_total: order.tax_total,
    grand_total: order.grand_total,
    updated_at: order.updated_at,
  };
}

export function approvalBindingMismatch(
  approval: ApprovalRequest,
  task: AgentTask,
  currentPolicyVersion: number,
): string | undefined {
  if (!approval.payload_digest || approval.payload_digest !== approvalPayloadDigest(task.tenant_id, task)) {
    return "The task payload no longer matches the reviewed approval.";
  }
  if (approval.policy_version === undefined || approval.policy_version !== currentPolicyVersion) {
    return "The autonomy policy changed after this approval was requested.";
  }
  if (!approval.entity_state_digest) return "The approval has no authoritative target-state binding.";
  const current = captureApprovalTargetState(approval.tenant_id, approval.target_entity_type, approval.target_entity_id);
  if (!current) return "The target state changed or can no longer be verified.";
  if (approvalDigest(current) !== approval.entity_state_digest) {
    const snapshot = approval.entity_state_snapshot || {};
    const fields = ["status", "payment_status", "fulfillment_status", "currency", "subtotal", "discount_total", "shipping_total", "tax_total", "grand_total", "updated_at"];
    for (const field of fields) {
      if (snapshot[field] !== undefined && snapshot[field] !== current[field]) {
        const label = field === "status" ? "Order status" : field.replaceAll("_", " ");
        return `${label.charAt(0).toUpperCase()}${label.slice(1)} changed from ${String(snapshot[field])} to ${String(current[field])}.`;
      }
    }
    return "The target state changed and no longer matches the reviewed snapshot.";
  }
  return undefined;
}
