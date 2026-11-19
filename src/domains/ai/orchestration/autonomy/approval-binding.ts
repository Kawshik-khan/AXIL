import { createHash } from "crypto";
import { AgentTask, ApprovalRequest } from "@/types/orchestration";
import { db } from "@/infrastructure/db";
import { loadCustomerRows, loadOrderRows, loadTenantRows } from "@/infrastructure/db/tenant-rows";

export type ApprovalTargetEntityType = ApprovalRequest["target_entity_type"];

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

/**
 * Zero-hydration: loads the rows an approval's target snapshot reads, for this request. Orders, customers and
 * inventory are not kept in memory on Postgres; payments and messages are. Call before captureApprovalTargetState or
 * approvalBindingMismatch, or a valid approval reads as "target can no longer be verified" (PR #82 review).
 */
export async function loadApprovalTarget(tenantId: string, entityType: string | undefined, entityId: string | undefined): Promise<void> {
  if (!entityType || !entityId) return;
  if (entityType === "ORDER") await loadOrderRows(tenantId, [entityId]);
  else if (entityType === "CUSTOMER") await loadCustomerRows(tenantId, [entityId]);
  else if (entityType === "INVENTORY") await loadTenantRows(tenantId, ["inventory_items", "product_variants", "products"]);
}

/** Authoritative versioned snapshots for approval-gated target entities. */
export function captureApprovalTargetState(tenantId: string, entityType: string, entityId: string): Record<string, unknown> | undefined {
  if (!entityId) return undefined;
  if (entityType === "ORDER") {
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
  if (entityType === "CUSTOMER") {
    const customer = db.findCustomerById(tenantId, entityId);
    if (!customer) return undefined;
    return {
      id: customer.id,
      status: customer.status,
      phone: customer.phone,
      email: customer.email ?? null,
      updated_at: customer.updated_at,
    };
  }
  if (entityType === "PAYMENT") {
    const payment = db.findPaymentById(tenantId, entityId);
    if (!payment) return undefined;
    return {
      id: payment.id,
      order_id: payment.order_id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      transaction_id: payment.transaction_id ?? null,
    };
  }
  if (entityType === "MESSAGE") {
    const message = db.findMessageById(tenantId, entityId);
    if (message) {
      return {
        id: message.id,
        conversation_id: message.conversation_id,
        status: message.status,
        updated_at: message.updated_at,
      };
    }
    const conversation = db.findConversationById(tenantId, entityId);
    if (!conversation) return undefined;
    return {
      id: conversation.id,
      customer_id: conversation.customer_id,
      channel_id: conversation.channel_id,
      status: conversation.status,
      updated_at: conversation.updated_at,
    };
  }
  if (entityType === "INVENTORY") {
    const items = db.getInventory(tenantId).filter((i) => i.product_variant_id === entityId);
    if (items.length === 0) return undefined;
    return {
      variant_id: entityId,
      total_available: items.reduce((sum, i) => sum + i.quantity_available, 0),
      total_reserved: items.reduce((sum, i) => sum + i.quantity_reserved, 0),
    };
  }
  return undefined;
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
    const fields = Object.keys({ ...snapshot, ...current });
    for (const field of fields) {
      if (snapshot[field] !== undefined && snapshot[field] !== current[field]) {
        const label =
          field === "status"
            ? `${approval.target_entity_type.charAt(0)}${approval.target_entity_type.slice(1).toLowerCase()} status`
            : field.replaceAll("_", " ");
        return `${label.charAt(0).toUpperCase()}${label.slice(1)} changed from ${String(snapshot[field])} to ${String(current[field])}.`;
      }
    }
    return "The target state changed and no longer matches the reviewed snapshot.";
  }
  return undefined;
}
