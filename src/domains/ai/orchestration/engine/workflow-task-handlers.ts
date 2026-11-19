import { z } from "zod";
import { db } from "@/infrastructure/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { RequestContext } from "@/lib/context";
import { randomSuffix } from "@/lib/ids";
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { loadCustomerRows, loadOrderRows, loadTenantRows, loadVariantRows } from "@/infrastructure/db/tenant-rows";
import { AgentTask, WorkflowArtifact } from "@/types/orchestration";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import { inventoryAgent } from "../agents/operations-inventory.agent";
import { shippingAgent } from "../agents/operations-shipping.agent";
import { paymentAgent } from "../agents/operations-payment.agent";
import { ProductService } from "@/domains/catalog/product.service";
import { CustomerService } from "@/domains/customers/customer.service";
import { OrderService } from "@/domains/orders/order.service";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { ReturnService } from "@/domains/returns/return.service";
import { PricingService } from "@/domains/pricing/pricing.service";
import { MarketingService } from "@/domains/marketing/marketing.service";
import { inventoryOperationsService } from "@/domains/operations/services/inventory-operations.service";
import { returnsOperationsService } from "@/domains/operations/services/returns-operations.service";
import { consentService } from "@/domains/growth/services/consent.service";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { PromptInjectionClassifier } from "@/domains/ai/safety/prompt-injection";
import { AiBudgetGuard } from "@/domains/ai/safety/budget-guard";
import { workflowBudgetService } from "./workflow-budget.service";

/** Authoritative wholesale tier discount schedule (percentage off subtotal). */
export const WHOLESALE_TIER_DISCOUNTS: ReadonlyArray<{ minQuantity: number; discountPercent: number }> = [
  { minQuantity: 100, discountPercent: 15 },
  { minQuantity: 50, discountPercent: 10 },
  { minQuantity: 20, discountPercent: 5 },
];

export const TASK_HANDLER_AGENT: Readonly<Record<string, string>> = Object.freeze({
  // Existing handlers
  AUDIT_WAREHOUSE_STOCK: "INVENTORY",
  CALCULATE_SHIPPING_ESTIMATE: "SHIPPING",
  CALCULATE_ESTIMATE: "SHIPPING",
  VERIFY_PAYMENT_TRX: "PAYMENT",
  // Phase 1: Read-only handlers
  CALCULATE_SALES_VELOCITY: "SALES",
  INSPECT_ORDER_RETURN_STATE: "ORDER_ASSISTANT",
  TRACK_PARCEL_STATUS: "SHIPPING",
  IDENTIFY_ABANDONED_CARTS: "ORDER_ASSISTANT",
  RETRIEVE_CUSTOMER_CONTEXT: "CUSTOMER_SUPPORT",
  CHECK_PRODUCT_AVAILABILITY: "INVENTORY",
  VALIDATE_PRODUCT_SPEC: "SALES",
  AUDIT_BULK_STOCK: "INVENTORY",
  CALCULATE_BULK_SHIPPING: "SHIPPING",
  // Phase 2: Draft-producing handlers (LLM text only, no effects)
  GENERATE_PERSONALIZED_MESSAGE: "SALES",
  NOTIFY_CUSTOMER_EMPATHY: "CUSTOMER_SUPPORT",
  PREPARE_REORDER_PROPOSAL: "ORDER_ASSISTANT",
  FORMULATE_WHOLESALE_QUOTE: "SALES",
  // Phase 3: Approval-gated effect handlers
  OUTBOUND_MESSAGE_APPROVAL: "SUPERVISOR",
  APPROVAL_REFUND_DISBURSEMENT: "SUPERVISOR",
});

export function isWorkflowTaskHandlerRegistered(taskType: string, agentType?: string): boolean {
  const registeredAgent = TASK_HANDLER_AGENT[taskType];
  return !!registeredAgent && (!agentType || registeredAgent === agentType);
}

function hasNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function hasPositiveNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val > 0;
}

export function isWorkflowTaskReady(
  taskType: string,
  agentType: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {},
): boolean {
  if (!isWorkflowTaskHandlerRegistered(taskType, agentType)) return false;

  const pick = (key: string) => input[key] ?? context[key];
  switch (taskType) {
    case "AUDIT_WAREHOUSE_STOCK":
    case "CALCULATE_SALES_VELOCITY":
    case "PREPARE_REORDER_PROPOSAL":
      return hasNonEmptyString(pick("variant_id"));

    case "CALCULATE_SHIPPING_ESTIMATE":
    case "CALCULATE_ESTIMATE":
      return hasNonEmptyString(pick("city")) && hasPositiveNumber(pick("weight_kg"));

    case "VERIFY_PAYMENT_TRX":
      return hasNonEmptyString(pick("payment_id"));

    case "INSPECT_ORDER_RETURN_STATE":
    case "APPROVAL_REFUND_DISBURSEMENT":
      return hasNonEmptyString(pick("order_id")) || hasNonEmptyString(pick("return_id"));

    case "TRACK_PARCEL_STATUS":
    case "NOTIFY_CUSTOMER_EMPATHY":
      return (
        hasNonEmptyString(pick("shipment_id")) ||
        hasNonEmptyString(pick("order_id")) ||
        hasNonEmptyString(pick("tracking_number")) ||
        hasNonEmptyString(pick("customer_id"))
      );

    case "IDENTIFY_ABANDONED_CARTS":
      return true;

    case "RETRIEVE_CUSTOMER_CONTEXT":
    case "CHECK_PRODUCT_AVAILABILITY":
    case "GENERATE_PERSONALIZED_MESSAGE":
    case "OUTBOUND_MESSAGE_APPROVAL":
      // In ABANDONED_CART_RECOVERY these can discover entities from IDENTIFY_ABANDONED_CARTS
      // or receive explicit customer_id / variant_id / product_id in input/context.
      return true;

    case "VALIDATE_PRODUCT_SPEC":
    case "AUDIT_BULK_STOCK":
      return hasNonEmptyString(pick("product_id")) || hasNonEmptyString(pick("variant_id")) || hasNonEmptyString(pick("sku"));

    case "CALCULATE_BULK_SHIPPING":
      return hasNonEmptyString(pick("city")) && (hasPositiveNumber(pick("weight_kg")) || hasPositiveNumber(pick("quantity")));

    case "FORMULATE_WHOLESALE_QUOTE":
      return (
        (hasNonEmptyString(pick("product_id")) || hasNonEmptyString(pick("variant_id")) || hasNonEmptyString(pick("sku"))) &&
        hasPositiveNumber(pick("quantity")) &&
        hasNonEmptyString(pick("city"))
      );

    default:
      return false;
  }
}

export class TaskOutcomeUnknownError extends Error {
  constructor(message = "The external action outcome could not be confirmed.") {
    super(message);
    this.name = "TaskOutcomeUnknownError";
  }
}

function parseTaskInput<T>(schema: z.ZodType<T>, raw: Record<string, unknown>, taskType: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    throw new AppError("VALIDATION_ERROR", `Invalid input for ${taskType}: ${details}`, 400);
  }
  return parsed.data;
}

const VariantInputSchema = z.object({
  variant_id: z.string().min(1),
}).strict();

const SalesVelocityInputSchema = z.object({
  variant_id: z.string().min(1),
  window_days: z.number().int().min(1).max(365).default(30),
}).strict();

const ShippingEstimateInputSchema = z.object({
  city: z.string().min(1),
  weight_kg: z.number().finite().positive(),
}).strict();

const VerifyPaymentInputSchema = z.object({
  payment_id: z.string().min(1),
}).strict();

const InspectOrderReturnSchema = z.object({
  order_id: z.string().min(1).optional(),
  return_id: z.string().min(1).optional(),
}).strict().refine((v) => Boolean(v.order_id || v.return_id), {
  message: "order_id or return_id is required",
});

const TrackParcelSchema = z.object({
  shipment_id: z.string().min(1).optional(),
  order_id: z.string().min(1).optional(),
  tracking_number: z.string().min(1).optional(),
}).strict().refine((v) => Boolean(v.shipment_id || v.order_id || v.tracking_number), {
  message: "shipment_id, order_id, or tracking_number is required",
});

const IdentifyAbandonedCartsSchema = z.object({
  min_cart_total_bdt: z.number().finite().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

const RetrieveCustomerContextSchema = z.object({
  customer_id: z.string().min(1),
  channel: z.enum(["WHATSAPP", "FACEBOOK", "INSTAGRAM", "TELEGRAM", "SMS", "EMAIL", "WEB_CHAT"]).default("WHATSAPP"),
}).strict();

const CheckProductAvailabilitySchema = z.object({
  variant_id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  quantity: z.number().int().min(1).default(1),
}).strict().refine((v) => Boolean(v.variant_id || v.product_id), {
  message: "variant_id or product_id is required",
});

const ValidateProductSpecSchema = z.object({
  product_id: z.string().min(1).optional(),
  variant_id: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  quantity: z.number().int().min(1).default(1),
}).strict().refine((v) => Boolean(v.product_id || v.variant_id || v.sku), {
  message: "product_id, variant_id, or sku is required",
});

const AuditBulkStockSchema = z.object({
  variant_id: z.string().min(1),
  requested_quantity: z.number().int().min(1).default(1),
}).strict();

const CalculateBulkShippingSchema = z.object({
  city: z.string().min(1),
  weight_kg: z.number().finite().positive().optional(),
  quantity: z.number().int().min(1).optional(),
}).strict().refine((v) => Boolean(v.weight_kg || v.quantity), {
  message: "weight_kg or quantity is required",
});

const PersonalizedMessageSchema = z.object({
  customer_id: z.string().min(1).optional(),
  variant_id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  coupon_code: z.string().min(1).optional(),
  tone: z.enum(["BANGLISH", "BANGLA", "ENGLISH"]).default("BANGLISH"),
}).strict();

/**
 * Draft only. Sending is a separate OUTBOUND_MESSAGE_APPROVAL step, so every customer-facing send goes through the
 * one effect handler and its approval gate (there is deliberately no `send` flag here).
 */
const NotifyCustomerEmpathySchema = z.object({
  customer_id: z.string().min(1).optional(),
  order_id: z.string().min(1).optional(),
  shipment_id: z.string().min(1).optional(),
  conversation_id: z.string().min(1).optional(),
  eta_note: z.string().max(300).optional(),
}).strict();

const PrepareReorderProposalSchema = z.object({
  variant_id: z.string().min(1),
  supplier_id: z.string().min(1).optional(),
  target_days: z.number().int().min(7).max(90).default(30),
}).strict();

const FormulateWholesaleQuoteSchema = z.object({
  product_id: z.string().min(1).optional(),
  variant_id: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  quantity: z.number().int().min(1),
  city: z.string().min(1),
  coupon_code: z.string().min(1).optional(),
}).strict();

const OutboundMessageApprovalSchema = z.object({
  conversation_id: z.string().min(1).optional(),
  customer_id: z.string().min(1).optional(),
  channel: z.enum(["WHATSAPP", "FACEBOOK", "INSTAGRAM", "TELEGRAM", "SMS", "EMAIL", "WEB_CHAT"]).default("WHATSAPP"),
  message_text: z.string().min(1).max(2000).optional(),
  simulate: z.boolean().optional(),
}).strict();

const ApprovalRefundDisbursementSchema = z.object({
  order_id: z.string().min(1),
  return_id: z.string().min(1).optional(),
  payment_id: z.string().min(1).optional(),
  amount: z.number().finite().positive().optional(),
  reason: z.string().min(3).max(500).default("Approved workflow refund disbursement"),
}).strict();

// =========================================================================
// EFFECT TASKS: what they do decides their gate, not the template's label
// =========================================================================

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type RiskName = (typeof RISK_ORDER)[number];

/**
 * Task types with an external or money effect, and the lowest risk they may run at. The executor raises a task's
 * risk to this floor before the approval check, so a template, planner or stored task can't label a customer
 * message or a refund as low risk and skip approval.
 */
export const EFFECT_TASK_RISK_FLOOR: Readonly<Record<string, RiskName>> = Object.freeze({
  OUTBOUND_MESSAGE_APPROVAL: "HIGH",
  APPROVAL_REFUND_DISBURSEMENT: "CRITICAL",
});

export function isEffectTask(taskType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EFFECT_TASK_RISK_FLOOR, taskType);
}

/** The higher of the task's own risk and its effect floor. */
export function effectiveRiskLevel(taskType: string, declared: string | undefined): RiskName {
  const declaredIdx = Math.max(0, RISK_ORDER.indexOf((declared ?? "LOW") as RiskName));
  const floor = EFFECT_TASK_RISK_FLOOR[taskType];
  const floorIdx = floor ? RISK_ORDER.indexOf(floor) : 0;
  return RISK_ORDER[Math.max(declaredIdx, floorIdx)];
}

/**
 * How much can still be refunded on an order, computed on exactly the payment ReturnService.processRefund records the
 * refund against (the first PAID payment, else the order's first payment), so the ceiling and the refund row can't
 * name different payments. That payment's amount minus every non-FAILED refund already recorded on it. Nothing is
 * refundable unless that payment was actually paid: PAID, or REFUNDED with a remainder (ReturnService marks a payment
 * REFUNDED even after a partial refund). With several PAID payments only the first counts, so this errs low.
 */
export async function refundableAmount(tenantId: string, orderId: string): Promise<{ paymentId: string; refundable: number } | undefined> {
  await loadOrderRows(tenantId, [orderId]);
  const order = db.findOrderById(tenantId, orderId);
  if (!order) throw new NotFoundError("Order", orderId);
  const payments = db.getPayments(tenantId, order.id);
  const paid = payments.find((p) => p.status === "PAID") || payments[0]; // the same pick as processRefund
  if (!paid || (paid.status !== "PAID" && paid.status !== "REFUNDED")) return undefined;
  const alreadyRefunded = db
    .getRefunds(tenantId)
    .filter((r) => r.payment_id === paid.id && r.status !== "FAILED")
    .reduce((sum, r) => sum + r.amount, 0);
  const refundable = Math.round((paid.amount - alreadyRefunded) * 100) / 100;
  return { paymentId: paid.id, refundable: Math.max(0, refundable) };
}

/** processRefund marks `return_id` COMPLETED, so it must be a return of this order (same tenant is not enough). */
function assertReturnBelongsToOrder(tenantId: string, returnId: string | undefined, orderId: string): void {
  if (!returnId) return;
  const ret = db.getReturns(tenantId).find((r) => r.id === returnId);
  if (!ret || ret.order_id !== orderId) {
    throw new AppError("VALIDATION_ERROR", `Return '${returnId}' is not a return of order '${orderId}'.`, 400);
  }
}

/**
 * Resolves an effect task's complete, final parameters before approval, from the task's own input first, then the
 * workflow context, then the steps it depends on. The executor stores the result as the task's input, so the
 * approval digest covers exactly what will run (message text, recipient, refund amount) and the approver sees it.
 * The effect handlers then read only `task.input`.
 */
export async function freezeEffectPayload(
  task: AgentTask,
  contextEntities: Record<string, unknown> | undefined,
  depOutputs: Record<string, Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const tenantId = task.tenant_id;
  switch (task.task_type) {
    case "OUTBOUND_MESSAGE_APPROVAL": {
      const draftOut = depOutputs.GENERATE_PERSONALIZED_MESSAGE ?? depOutputs.NOTIFY_CUSTOMER_EMPATHY;
      const fromDraft = (key: string) => (draftOut && draftOut[key] !== undefined && draftOut[key] !== null ? { [key]: draftOut[key] } : {});
      const raw = {
        ...fromDraft("customer_id"),
        ...fromDraft("conversation_id"),
        ...(typeof draftOut?.draft_text === "string" ? { message_text: draftOut.draft_text } : {}),
        ...pickParam(task, contextEntities, ["conversation_id", "customer_id", "channel", "message_text", "simulate"]),
      };
      // An explicit message in the task input wins over the draft; otherwise the draft is what gets approved.
      if (typeof task.input?.message_text === "string") raw.message_text = task.input.message_text;
      const parsed = parseTaskInput(OutboundMessageApprovalSchema, raw, task.task_type);
      if (!parsed.message_text || !parsed.message_text.trim()) {
        throw new AppError("VALIDATION_ERROR", "An outbound message needs approved text: no message_text and no draft from an earlier step.", 400);
      }
      if (!parsed.conversation_id && !parsed.customer_id) {
        throw new AppError("VALIDATION_ERROR", "An outbound message needs a conversation_id or customer_id to address it to.", 400);
      }
      return { ...parsed, message_text: parsed.message_text.trim() };
    }

    case "APPROVAL_REFUND_DISBURSEMENT": {
      const inspectOut = depOutputs.INSPECT_ORDER_RETURN_STATE;
      const raw = {
        ...(inspectOut?.order_id ? { order_id: inspectOut.order_id } : {}),
        ...(inspectOut?.return_id ? { return_id: inspectOut.return_id } : {}),
        ...pickParam(task, contextEntities, ["order_id", "return_id", "amount", "reason"]),
      };
      const parsed = parseTaskInput(ApprovalRefundDisbursementSchema, raw, task.task_type);
      assertReturnBelongsToOrder(tenantId, parsed.return_id, parsed.order_id);
      const ceiling = await refundableAmount(tenantId, parsed.order_id);
      if (!ceiling || ceiling.refundable <= 0) {
        throw new AppError("VALIDATION_ERROR", `Order '${parsed.order_id}' has no paid amount left to refund.`, 400);
      }
      const amount = parsed.amount ?? ceiling.refundable;
      if (amount > ceiling.refundable) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Refund of ${amount} BDT exceeds the ${ceiling.refundable} BDT still refundable on order '${parsed.order_id}'.`,
          400,
        );
      }
      return { ...parsed, payment_id: ceiling.paymentId, amount };
    }

    default:
      return { ...task.input };
  }
}

function pickParam(
  task: AgentTask,
  contextEntities: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const val = task.input?.[key] ?? contextEntities?.[key];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function saveArtifact(
  tenantId: string,
  workflowId: string,
  taskId: string,
  artifactType: WorkflowArtifact["artifact_type"],
  name: string,
  content: Record<string, unknown>,
  _createdByAgent: AgentTask["agent_type"],
): WorkflowArtifact {
  const artifact: WorkflowArtifact = {
    id: `art_${Date.now()}_${randomSuffix()}`,
    tenant_id: tenantId,
    workflow_id: workflowId,
    task_id: taskId,
    name,
    artifact_type: artifactType,
    schema_version: "1.0",
    // What `is_verified` covers: the verifier checks the structured numbers (prices, stock, totals) against the store;
    // it does not read the model-written text, so a person still reviews the wording (the send step needs approval).
    content: { ...content, verification_scope: "STRUCTURED_NUMBERS_ONLY" },
    // Set to true by the executor only after the verifier has checked this task's output.
    is_verified: false,
    created_at: new Date().toISOString(),
  };
  db.insertWorkflowArtifact(artifact);
  return artifact;
}

function sanitizeUntrustedText(raw: string): string {
  const analysis = PromptInjectionClassifier.analyze(raw);
  if (analysis.isInjection) {
    return "[REDACTED_UNTRUSTED_TEXT: potential prompt-injection pattern detected]";
  }
  return raw.replace(/<\/?untrusted_data>/gi, "").slice(0, 500);
}

async function generateTextOnlyDraft(params: {
  tenantId: string;
  workflowId: string;
  taskId: string;
  budgetReservationId?: string;
  systemInstruction: string;
  untrustedFacts: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ text: string; tokensUsed: number; costUsd: number; demo: boolean }> {
  const budgetCheck = AiBudgetGuard.checkBudget(params.tenantId);
  if (!budgetCheck.allowed) {
    throw new AppError("WORKFLOW_BUDGET_EXCEEDED", budgetCheck.reason || "Tenant AI monthly budget exceeded.", 429);
  }

  const safeFacts = JSON.stringify(params.untrustedFacts, (_k, v) =>
    typeof v === "string" ? sanitizeUntrustedText(v) : v
  );

  const response = await modelRouter.chatWithRouting(
    "TIER_1_FAST",
    [
      {
        role: "system",
        content: `${params.systemInstruction} Write concise natural-language copy only. Never invent or alter prices, stock counts, totals, or dates.`,
      },
      {
        role: "user",
        content: `Draft text using only these verified facts:\n<untrusted_data>\n${safeFacts}\n</untrusted_data>`,
      },
    ],
    undefined,
    { signal: params.signal, maxTokens: 300 },
  );

  const tokensUsed = response.usage?.total_tokens ?? 0;
  const costUsd = response.costUsd ?? 0;

  if (params.budgetReservationId && (tokensUsed > 0 || costUsd > 0)) {
    await workflowBudgetService.consumeTaskUsage(params.tenantId, params.workflowId, params.taskId, params.budgetReservationId, {
      tokens: tokensUsed,
      costUsd,
    });
  }
  if (tokensUsed > 0 || costUsd > 0) {
    AiBudgetGuard.recordSpend(params.tenantId, tokensUsed, costUsd);
  }

  return {
    text: response.content,
    tokensUsed,
    costUsd,
    demo: response.demo,
  };
}

async function dispatchOutboundOrSimulate(params: {
  executionContext: RequestContext;
  task: AgentTask;
  conversationId?: string;
  customerId?: string;
  messageText: string;
  forceSimulate?: boolean;
}): Promise<Record<string, unknown>> {
  const { executionContext, task, conversationId, customerId, messageText, forceSimulate } = params;
  const tenantId = task.tenant_id;

  assertNotKilled(tenantId, "WORKFLOW", task.workflow_id);
  assertNotKilled(tenantId, "WORKFLOW", task.task_type);

  if (forceSimulate || !conversationId || !isFeatureEnabled("real_messaging", tenantId)) {
    return {
      status: "SIMULATED",
      delivery_status: "NOT_SENT",
      reason: !conversationId
        ? "No conversation_id provided for outbound delivery; message stored as draft only."
        : !isFeatureEnabled("real_messaging", tenantId)
          ? "real_messaging feature is not enabled for this workspace; message was not sent."
          : "Simulation requested; message was not sent.",
      customer_id: customerId ?? null,
      conversation_id: conversationId ?? null,
      idempotency_key: task.idempotency_key,
      draft_text: messageText,
    };
  }

  const conversation = db.findConversationById(tenantId, conversationId);
  if (!conversation) {
    throw new NotFoundError("Conversation", conversationId);
  }
  const channel = db.findConnectedChannelById(tenantId, conversation.channel_id);
  if (!channel || channel.status !== "ACTIVE") {
    return {
      status: "SIMULATED",
      delivery_status: "NOT_SENT",
      reason: "Connected channel is missing or inactive; message was not sent.",
      conversation_id: conversationId,
      idempotency_key: task.idempotency_key,
      draft_text: messageText,
    };
  }

  const delivered = await OutboundMessageService.sendMessage(executionContext, conversationId, {
    text: messageText,
    idempotency_key: task.idempotency_key,
  });

  if (delivered.delivery?.last_error_code === "DELIVERY_UNCERTAIN") {
    throw new TaskOutcomeUnknownError(
      delivered.failure_reason || "Outbound message delivery outcome is uncertain."
    );
  }

  if (delivered.status === "FAILED" || delivered.status === "CANCELLED") {
    throw new AppError(
      "OUTBOUND_DELIVERY_FAILED",
      delivered.failure_reason || `Outbound message ended in ${delivered.status}`,
      502
    );
  }

  return {
    status: delivered.status,
    delivery_status: delivered.status,
    message_id: delivered.id,
    external_message_id: delivered.external_message_id ?? null,
    conversation_id: conversationId,
    channel_type: channel.type,
    idempotency_key: task.idempotency_key,
  };
}

export async function executeTypedWorkflowTask(params: {
  task: AgentTask;
  executionContext: RequestContext;
  contextEntities?: Record<string, unknown>;
  depOutputs?: Record<string, Record<string, unknown>>;
  signal?: AbortSignal;
  budgetReservationId?: string;
}): Promise<Record<string, unknown>> {
  const { task, executionContext, contextEntities, depOutputs = {}, signal, budgetReservationId } = params;
  const tenantId = task.tenant_id;

  switch (task.task_type) {
    // =========================================================================
    // EXISTING + PHASE 1 READ-ONLY HANDLERS
    // =========================================================================
    case "AUDIT_WAREHOUSE_STOCK": {
      const parsed = parseTaskInput(VariantInputSchema, pickParam(task, contextEntities, ["variant_id"]), task.task_type);
      await loadVariantRows(tenantId, [parsed.variant_id]);
      const variant = db.findVariantById(tenantId, parsed.variant_id);
      if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id);
      await inventoryRepository.getStockLevels(tenantId);
      const stockResult = inventoryAgent.checkStock(executionContext, parsed.variant_id);
      return {
        variant_id: parsed.variant_id,
        available_quantity: stockResult.available,
        reserved_quantity: stockResult.reserved,
        low_stock: stockResult.low_stock,
        status: "STOCK_AUDITED",
      };
    }

    case "CALCULATE_SHIPPING_ESTIMATE":
    case "CALCULATE_ESTIMATE": {
      const parsed = parseTaskInput(
        ShippingEstimateInputSchema,
        pickParam(task, contextEntities, ["city", "weight_kg"]),
        task.task_type
      );
      const shippingResult = shippingAgent.calculateEstimate(executionContext, parsed.city, parsed.weight_kg);
      return {
        ...shippingResult,
        status: "SHIPPING_CALCULATED",
      };
    }

    case "VERIFY_PAYMENT_TRX": {
      const parsed = parseTaskInput(VerifyPaymentInputSchema, pickParam(task, contextEntities, ["payment_id"]), task.task_type);
      const paymentResult = paymentAgent.verifyPayment(executionContext, parsed.payment_id);
      if (!paymentResult) throw new NotFoundError("Payment", parsed.payment_id);
      const payment = db.findPaymentById(tenantId, parsed.payment_id);
      return {
        payment_id: parsed.payment_id,
        order_id: payment?.order_id ?? null,
        verified: paymentResult.verified,
        status: paymentResult.status,
        amount: paymentResult.amount,
        method: paymentResult.method,
      };
    }

    case "CALCULATE_SALES_VELOCITY": {
      const auditOut = depOutputs.AUDIT_WAREHOUSE_STOCK;
      const raw = {
        ...pickParam(task, contextEntities, ["variant_id", "window_days"]),
        ...(auditOut?.variant_id && !task.input?.variant_id && !contextEntities?.variant_id ? { variant_id: auditOut.variant_id } : {}),
      };
      const parsed = parseTaskInput(SalesVelocityInputSchema, raw, task.task_type);
      await loadTenantRows(tenantId, ["orders", "order_items", "inventory_items", "products", "product_variants"]);
      const variant = db.findVariantById(tenantId, parsed.variant_id);
      if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id);
      const risks = inventoryOperationsService.evaluateStockoutRisks(tenantId);
      const match = risks.find((r) => r.variant_id === parsed.variant_id);
      return {
        variant_id: parsed.variant_id,
        sku: match?.sku ?? variant.sku,
        window_days: parsed.window_days,
        current_available: match?.current_available ?? 0,
        daily_sales_velocity: match?.daily_sales_velocity ?? 0,
        days_of_supply_remaining: match?.days_of_supply_remaining ?? 999,
        risk_level: match?.risk_level ?? "NONE",
        recommended_reorder_quantity: match?.recommended_reorder_quantity ?? 0,
        status: "VELOCITY_CALCULATED",
      };
    }

    case "INSPECT_ORDER_RETURN_STATE": {
      const verifyOut = depOutputs.VERIFY_PAYMENT_TRX;
      const raw = {
        ...pickParam(task, contextEntities, ["order_id", "return_id"]),
        ...(verifyOut?.order_id && !task.input?.order_id && !contextEntities?.order_id ? { order_id: verifyOut.order_id } : {}),
      };
      const parsed = parseTaskInput(InspectOrderReturnSchema, raw, task.task_type);
      await loadTenantRows(tenantId, ["orders", "order_items", "returns"]);
      const allReturns = db.getReturns(tenantId);
      const matchedReturn = parsed.return_id
        ? allReturns.find((r) => r.id === parsed.return_id)
        : allReturns.find((r) => r.order_id === parsed.order_id);
      const resolvedOrderId = parsed.order_id || matchedReturn?.order_id;
      if (!resolvedOrderId) throw new NotFoundError("Return", parsed.return_id || "unknown");
      await loadOrderRows(tenantId, [resolvedOrderId]);
      const order = await OrderService.getOrderById(executionContext, resolvedOrderId);
      const eligibility = returnsOperationsService.evaluateEligibility(tenantId, order.id, order.customer_id);
      return {
        order_id: order.id,
        order_number: order.order_number,
        order_status: order.status,
        payment_status: order.payment_status,
        grand_total: order.grand_total,
        return_id: matchedReturn?.id ?? null,
        return_status: matchedReturn?.status ?? null,
        warehouse_received: matchedReturn?.status === "RECEIVED" || matchedReturn?.status === "COMPLETED" || order.status === "RETURNED",
        eligibility,
        status: "RETURN_STATE_INSPECTED",
      };
    }

    case "TRACK_PARCEL_STATUS": {
      const parsed = parseTaskInput(
        TrackParcelSchema,
        pickParam(task, contextEntities, ["shipment_id", "order_id", "tracking_number"]),
        task.task_type
      );
      if (parsed.order_id) await loadOrderRows(tenantId, [parsed.order_id]);
      const shipments = await ShippingService.listShipments(executionContext, parsed.order_id);
      const shipment = shipments.find(
        (s) =>
          (parsed.shipment_id && s.id === parsed.shipment_id) ||
          (parsed.order_id && s.order_id === parsed.order_id) ||
          (parsed.tracking_number && s.tracking_number === parsed.tracking_number)
      );
      if (!shipment) {
        throw new NotFoundError("Shipment", parsed.shipment_id || parsed.tracking_number || parsed.order_id || "unknown");
      }
      await loadOrderRows(tenantId, [shipment.order_id]);
      const order = db.findOrderById(tenantId, shipment.order_id);
      const exceptions = db.getShipmentExceptions(tenantId).filter((e) => e.shipment_id === shipment.id);
      return {
        shipment_id: shipment.id,
        order_id: shipment.order_id,
        customer_id: order?.customer_id ?? null,
        courier_provider: shipment.courier_provider,
        tracking_number: shipment.tracking_number,
        recorded_status: shipment.status,
        tracking_source: "SIMULATED",
        live_tracking_available: false,
        exceptions: exceptions.map((e) => ({ id: e.id, type: e.exception_type, severity: e.severity, status: e.status })),
        note: "No live courier tracking API is integrated; returning stored shipment record.",
        status: "PARCEL_STATUS_CHECKED",
      };
    }

    case "IDENTIFY_ABANDONED_CARTS": {
      const parsed = parseTaskInput(
        IdentifyAbandonedCartsSchema,
        pickParam(task, contextEntities, ["min_cart_total_bdt", "limit"]),
        task.task_type
      );
      await loadTenantRows(tenantId, ["abandoned_carts", "customers"]);
      const service = new MarketingService();
      const carts = service
        .getAbandonedCarts(tenantId)
        .filter((c) => c.abandoned_total_bdt >= parsed.min_cart_total_bdt)
        .sort((a, b) => b.abandoned_total_bdt - a.abandoned_total_bdt)
        .slice(0, parsed.limit);
      const primary = carts[0] ?? null;
      return {
        carts: carts.map((c) => ({
          id: c.id,
          customer_id: c.customer_id,
          abandoned_total_bdt: c.abandoned_total_bdt,
          items_count: c.cart_items.length,
          cart_items: c.cart_items,
          abandoned_at: c.abandoned_at,
        })),
        total_found: carts.length,
        total_abandoned_bdt: carts.reduce((sum, c) => sum + c.abandoned_total_bdt, 0),
        customer_id: primary?.customer_id ?? null,
        primary_cart: primary ? { id: primary.id, customer_id: primary.customer_id, cart_items: primary.cart_items, total_bdt: primary.abandoned_total_bdt } : null,
        status: "ABANDONED_CARTS_IDENTIFIED",
      };
    }

    case "RETRIEVE_CUSTOMER_CONTEXT": {
      const cartOut = depOutputs.IDENTIFY_ABANDONED_CARTS;
      const trackOut = depOutputs.TRACK_PARCEL_STATUS;
      const raw = {
        ...pickParam(task, contextEntities, ["customer_id", "channel"]),
        ...(!task.input?.customer_id && !contextEntities?.customer_id
          ? { customer_id: cartOut?.customer_id ?? trackOut?.customer_id }
          : {}),
      };
      const parsed = parseTaskInput(RetrieveCustomerContextSchema, raw, task.task_type);
      await loadCustomerRows(tenantId, [parsed.customer_id]);
      const customer = await CustomerService.getCustomerById(executionContext, parsed.customer_id);
      const recentOrders = await OrderService.listOrders(executionContext, { customer_id: customer.id, limit: 10 });
      const consentChannel: "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM" | "WEBSITE_CHAT" | "EMAIL" | "TELEGRAM" =
        parsed.channel === "FACEBOOK"
          ? "FACEBOOK_MESSENGER"
          : parsed.channel === "WEB_CHAT"
            ? "WEBSITE_CHAT"
            : parsed.channel === "SMS"
              ? "WHATSAPP"
              : parsed.channel;
      const hasMarketingConsent = consentService.hasConsent(tenantId, customer.id, consentChannel);
      const prefs = db.getCommunicationPreferences(tenantId, customer.id);
      return {
        customer_id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`.trim(),
        phone: customer.phone,
        email: customer.email ?? null,
        total_orders: recentOrders.total,
        recent_order_ids: recentOrders.orders.map((o) => o.id),
        marketing_consent: hasMarketingConsent,
        preferences: prefs.map((p) => ({ channel: p.channel, purpose: p.purpose, status: p.status })),
        status: "CUSTOMER_CONTEXT_RETRIEVED",
      };
    }

    case "CHECK_PRODUCT_AVAILABILITY": {
      const cartOut = depOutputs.IDENTIFY_ABANDONED_CARTS;
      const primaryCart = cartOut?.primary_cart as { cart_items?: Array<{ product_id?: string }> } | null | undefined;
      const firstCartProductId = primaryCart?.cart_items?.[0]?.product_id;
      const raw = {
        ...pickParam(task, contextEntities, ["variant_id", "product_id", "quantity"]),
        ...(!task.input?.variant_id && !task.input?.product_id && !contextEntities?.variant_id && !contextEntities?.product_id && firstCartProductId
          ? { product_id: firstCartProductId }
          : {}),
      };
      const parsed = parseTaskInput(CheckProductAvailabilitySchema, raw, task.task_type);
      await loadTenantRows(tenantId, ["products", "product_variants", "inventory_items"]);
      if (parsed.variant_id) {
        const variant = db.findVariantById(tenantId, parsed.variant_id);
        if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id);
        const stock = inventoryAgent.checkStock(executionContext, parsed.variant_id);
        return {
          variant_id: parsed.variant_id,
          product_id: variant.product_id,
          unit_price: variant.price,
          available_quantity: stock.available,
          requested_quantity: parsed.quantity,
          all_available: stock.available >= parsed.quantity,
          status: "PRODUCT_AVAILABILITY_CHECKED",
        };
      }
      const product = await ProductService.getProductById(executionContext, parsed.product_id!);
      const variants = db.getProductVariants(tenantId, product.id);
      const firstVariant = variants[0];
      const stock = firstVariant ? inventoryAgent.checkStock(executionContext, firstVariant.id) : { available: 0, reserved: 0, low_stock: true };
      return {
        product_id: product.id,
        variant_id: firstVariant?.id ?? null,
        unit_price: firstVariant?.price ?? product.base_price,
        available_quantity: stock.available,
        requested_quantity: parsed.quantity,
        all_available: stock.available >= parsed.quantity,
        status: "PRODUCT_AVAILABILITY_CHECKED",
      };
    }

    case "VALIDATE_PRODUCT_SPEC": {
      const parsed = parseTaskInput(
        ValidateProductSpecSchema,
        pickParam(task, contextEntities, ["product_id", "variant_id", "sku", "quantity"]),
        task.task_type
      );
      await loadTenantRows(tenantId, ["products", "product_variants"]);
      const variant = parsed.variant_id
        ? db.findVariantById(tenantId, parsed.variant_id)
        : parsed.sku
          ? db.findVariantBySku(tenantId, parsed.sku)
          : undefined;
      const productId = parsed.product_id || variant?.product_id;
      const product = productId ? await ProductService.getProductById(executionContext, productId) : undefined;
      const resolvedVariant = variant ?? (product ? db.getProductVariants(tenantId, product.id)[0] : undefined);
      if (!product || !resolvedVariant) {
        throw new NotFoundError("Product", parsed.product_id || parsed.variant_id || parsed.sku || "unknown");
      }
      return {
        product_id: product.id,
        product_name: product.name,
        variant_id: resolvedVariant.id,
        sku: resolvedVariant.sku,
        unit_price: resolvedVariant.price,
        currency: product.currency || "BDT",
        product_status: product.status,
        quantity: parsed.quantity,
        status: "PRODUCT_SPEC_VALIDATED",
      };
    }

    case "AUDIT_BULK_STOCK": {
      const specOut = depOutputs.VALIDATE_PRODUCT_SPEC;
      const raw = {
        ...pickParam(task, contextEntities, ["variant_id", "requested_quantity"]),
        ...(specOut?.variant_id && !task.input?.variant_id && !contextEntities?.variant_id ? { variant_id: specOut.variant_id } : {}),
        ...(specOut?.quantity && !task.input?.requested_quantity && !contextEntities?.requested_quantity
          ? { requested_quantity: contextEntities?.quantity ?? specOut.quantity }
          : contextEntities?.quantity && !task.input?.requested_quantity
            ? { requested_quantity: contextEntities.quantity }
            : {}),
      };
      const parsed = parseTaskInput(AuditBulkStockSchema, raw, task.task_type);
      await loadVariantRows(tenantId, [parsed.variant_id]);
      const variant = db.findVariantById(tenantId, parsed.variant_id);
      if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id);
      await inventoryRepository.getStockLevels(tenantId);
      const stock = inventoryAgent.checkStock(executionContext, parsed.variant_id);
      return {
        variant_id: parsed.variant_id,
        available_quantity: stock.available,
        reserved_quantity: stock.reserved,
        requested_quantity: parsed.requested_quantity,
        can_fulfill_in_full: stock.available >= parsed.requested_quantity,
        shortfall: Math.max(0, parsed.requested_quantity - stock.available),
        low_stock: stock.low_stock,
        status: "BULK_STOCK_AUDITED",
      };
    }

    case "CALCULATE_BULK_SHIPPING": {
      const specOut = depOutputs.VALIDATE_PRODUCT_SPEC;
      const raw = {
        ...pickParam(task, contextEntities, ["city", "weight_kg", "quantity"]),
        ...(specOut?.quantity && !task.input?.quantity && !contextEntities?.quantity ? { quantity: specOut.quantity } : {}),
      };
      const parsed = parseTaskInput(CalculateBulkShippingSchema, raw, task.task_type);
      const weightKg = parsed.weight_kg ?? Math.max(0.5, (parsed.quantity ?? 1) * 0.35);
      const estimate = shippingAgent.calculateEstimate(executionContext, parsed.city, weightKg);
      return {
        ...estimate,
        city: parsed.city,
        weight_kg: weightKg,
        status: "BULK_SHIPPING_CALCULATED",
      };
    }

    // =========================================================================
    // PHASE 2: DRAFT-PRODUCING HANDLERS (LLM TEXT ONLY, NO EFFECTS)
    // =========================================================================
    case "GENERATE_PERSONALIZED_MESSAGE": {
      const custOut = depOutputs.RETRIEVE_CUSTOMER_CONTEXT;
      const prodOut = depOutputs.CHECK_PRODUCT_AVAILABILITY;
      const raw = {
        ...pickParam(task, contextEntities, ["customer_id", "variant_id", "product_id", "coupon_code", "tone"]),
        ...(!task.input?.customer_id && custOut?.customer_id ? { customer_id: custOut.customer_id } : {}),
        ...(!task.input?.variant_id && prodOut?.variant_id ? { variant_id: prodOut.variant_id } : {}),
        ...(!task.input?.product_id && prodOut?.product_id ? { product_id: prodOut.product_id } : {}),
      };
      const parsed = parseTaskInput(PersonalizedMessageSchema, raw, task.task_type);
      const unitPrice = typeof prodOut?.unit_price === "number" ? prodOut.unit_price : undefined;
      const availableQty = typeof prodOut?.available_quantity === "number" ? prodOut.available_quantity : undefined;
      const authoritativeNumbers: Record<string, unknown> = {
        ...(parsed.variant_id ? { variant_id: parsed.variant_id } : {}),
        ...(unitPrice !== undefined ? { unit_price: unitPrice } : {}),
        ...(availableQty !== undefined ? { available_quantity: availableQty } : {}),
      };

      const draft = await generateTextOnlyDraft({
        tenantId,
        workflowId: task.workflow_id,
        taskId: task.id,
        budgetReservationId,
        systemInstruction: `You are a Bangladeshi e-commerce sales assistant writing a ${parsed.tone} cart recovery message.`,
        untrustedFacts: {
          customer_name: custOut?.name ?? "Valued Customer",
          coupon_code: parsed.coupon_code ?? null,
          ...authoritativeNumbers,
        },
        signal,
      });

      const artifact = saveArtifact(
        tenantId,
        task.workflow_id,
        task.id,
        "OUTBOUND_MESSAGE_DRAFT",
        "Cart Recovery Message Draft",
        { draft_text: draft.text, tone: parsed.tone, authoritative_numbers: authoritativeNumbers, demo: draft.demo },
        task.agent_type
      );

      return {
        draft_type: "MESSAGE_DRAFT",
        artifact_id: artifact.id,
        customer_id: parsed.customer_id ?? null,
        draft_text: draft.text,
        authoritative_numbers: authoritativeNumbers,
        demo: draft.demo,
        status: "DRAFT_READY",
      };
    }

    case "NOTIFY_CUSTOMER_EMPATHY": {
      if (task.input && ("send" in task.input || "simulate" in task.input)) {
        throw new AppError(
          "VALIDATION_ERROR",
          "NOTIFY_CUSTOMER_EMPATHY only drafts. Send through an OUTBOUND_MESSAGE_APPROVAL step, which needs approval.",
          400,
        );
      }
      const trackOut = depOutputs.TRACK_PARCEL_STATUS;
      const raw = {
        ...pickParam(task, contextEntities, ["customer_id", "order_id", "shipment_id", "conversation_id", "eta_note"]),
        ...(!task.input?.customer_id && trackOut?.customer_id ? { customer_id: trackOut.customer_id } : {}),
        ...(!task.input?.order_id && trackOut?.order_id ? { order_id: trackOut.order_id } : {}),
        ...(!task.input?.shipment_id && trackOut?.shipment_id ? { shipment_id: trackOut.shipment_id } : {}),
      };
      const parsed = parseTaskInput(NotifyCustomerEmpathySchema, raw, task.task_type);

      const draft = await generateTextOnlyDraft({
        tenantId,
        workflowId: task.workflow_id,
        taskId: task.id,
        budgetReservationId,
        systemInstruction: "You are an empathetic Bangladeshi customer support specialist notifying a customer about a delivery delay.",
        untrustedFacts: {
          order_id: parsed.order_id ?? null,
          shipment_id: parsed.shipment_id ?? null,
          courier_provider: trackOut?.courier_provider ?? null,
          tracking_number: trackOut?.tracking_number ?? null,
          recorded_status: trackOut?.recorded_status ?? null,
          eta_note: parsed.eta_note ?? "Updated delivery ETA will follow shortly.",
        },
        signal,
      });

      const artifact = saveArtifact(
        tenantId,
        task.workflow_id,
        task.id,
        "OUTBOUND_MESSAGE_DRAFT",
        "Customer Delay Notification Draft",
        { draft_text: draft.text, order_id: parsed.order_id ?? null, shipment_id: parsed.shipment_id ?? null, demo: draft.demo },
        task.agent_type
      );

      // Draft only: a following OUTBOUND_MESSAGE_APPROVAL step sends it after approval.
      return {
        mode: "DRAFT",
        draft_type: "EMPATHY_NOTIFICATION_DRAFT",
        artifact_id: artifact.id,
        customer_id: parsed.customer_id ?? (typeof trackOut?.customer_id === "string" ? trackOut.customer_id : null),
        conversation_id: parsed.conversation_id ?? null,
        order_id: parsed.order_id ?? null,
        draft_text: draft.text,
        demo: draft.demo,
        status: "DRAFT_READY",
      };
    }

    case "PREPARE_REORDER_PROPOSAL": {
      const velOut = depOutputs.CALCULATE_SALES_VELOCITY;
      const auditOut = depOutputs.AUDIT_WAREHOUSE_STOCK;
      const raw = {
        ...pickParam(task, contextEntities, ["variant_id", "supplier_id", "target_days"]),
        ...(!task.input?.variant_id && !contextEntities?.variant_id
          ? { variant_id: velOut?.variant_id ?? auditOut?.variant_id }
          : {}),
      };
      const parsed = parseTaskInput(PrepareReorderProposalSchema, raw, task.task_type);
      await loadTenantRows(tenantId, ["products", "product_variants", "inventory_items", "suppliers", "supplier_products"]);
      const variant = db.findVariantById(tenantId, parsed.variant_id);
      if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id);

      const stock = inventoryAgent.checkStock(executionContext, parsed.variant_id);
      const dailyVelocity = typeof velOut?.daily_sales_velocity === "number" ? velOut.daily_sales_velocity : 1;
      const supplierProducts = db.getSupplierProducts(tenantId, parsed.supplier_id).filter((sp) => sp.product_variant_id === parsed.variant_id);
      const chosenSP = supplierProducts.sort((a, b) => (a.is_preferred === b.is_preferred ? a.cost_price - b.cost_price : a.is_preferred ? -1 : 1))[0];
      const unitCost = chosenSP?.cost_price ?? variant.cost_price ?? variant.price;
      const moq = chosenSP?.moq ?? 10;
      const targetUnits = Math.max(moq, Math.ceil(dailyVelocity * parsed.target_days) - stock.available);
      const estimatedCost = Math.round(targetUnits * unitCost * 100) / 100;

      const authoritativeNumbers = {
        variant_id: parsed.variant_id,
        available_quantity: stock.available,
        recommended_quantity: targetUnits,
        unit_cost: unitCost,
        estimated_cost_bdt: estimatedCost,
        moq,
      };

      const draft = await generateTextOnlyDraft({
        tenantId,
        workflowId: task.workflow_id,
        taskId: task.id,
        budgetReservationId,
        systemInstruction: "You are an inventory operations planner drafting a concise reorder purchase proposal memo for merchant review.",
        untrustedFacts: {
          sku: variant.sku,
          supplier_id: chosenSP?.supplier_id ?? null,
          ...authoritativeNumbers,
        },
        signal,
      });

      const artifact = saveArtifact(
        tenantId,
        task.workflow_id,
        task.id,
        "INVENTORY_REORDER_PROPOSAL",
        `Reorder Proposal (${variant.sku})`,
        { draft_text: draft.text, authoritative_numbers: authoritativeNumbers, supplier_id: chosenSP?.supplier_id ?? null, demo: draft.demo },
        task.agent_type
      );

      return {
        draft_type: "REORDER_PROPOSAL",
        artifact_id: artifact.id,
        variant_id: parsed.variant_id,
        available_quantity: stock.available,
        recommended_quantity: targetUnits,
        estimated_cost_bdt: estimatedCost,
        authoritative_numbers: authoritativeNumbers,
        draft_text: draft.text,
        demo: draft.demo,
        status: "PROPOSAL_DRAFTED",
      };
    }

    case "FORMULATE_WHOLESALE_QUOTE": {
      const specOut = depOutputs.VALIDATE_PRODUCT_SPEC;
      const shipOut = depOutputs.CALCULATE_BULK_SHIPPING;
      const stockOut = depOutputs.AUDIT_BULK_STOCK;
      const raw = {
        ...pickParam(task, contextEntities, ["product_id", "variant_id", "sku", "quantity", "city", "coupon_code"]),
        ...(!task.input?.variant_id && specOut?.variant_id ? { variant_id: specOut.variant_id } : {}),
        ...(!task.input?.product_id && specOut?.product_id ? { product_id: specOut.product_id } : {}),
        ...(!task.input?.city && shipOut?.city ? { city: shipOut.city } : {}),
        ...(!task.input?.quantity && specOut?.quantity ? { quantity: specOut.quantity } : {}),
      };
      const parsed = parseTaskInput(FormulateWholesaleQuoteSchema, raw, task.task_type);
      await loadTenantRows(tenantId, ["products", "product_variants", "coupons"]);
      const variant = parsed.variant_id
        ? db.findVariantById(tenantId, parsed.variant_id)
        : parsed.sku
          ? db.findVariantBySku(tenantId, parsed.sku)
          : parsed.product_id
            ? db.getProductVariants(tenantId, parsed.product_id)[0]
            : undefined;
      if (!variant) throw new NotFoundError("ProductVariant", parsed.variant_id || parsed.sku || parsed.product_id || "unknown");

      const deliveryZone = parsed.city.toLowerCase().includes("dhaka") || parsed.city.toLowerCase().includes("ঢাকা")
        ? "INSIDE_DHAKA"
        : "OUTSIDE_DHAKA";
      const pricing = await PricingService.calculateOrderPricing(
        tenantId,
        [{ variant_id: variant.id, quantity: parsed.quantity }],
        deliveryZone,
        parsed.coupon_code
      );

      const tier = WHOLESALE_TIER_DISCOUNTS.find((t) => parsed.quantity >= t.minQuantity);
      const tierDiscount = tier ? Math.round(pricing.subtotal * (tier.discountPercent / 100) * 100) / 100 : 0;
      const discountTotal = Math.max(pricing.discount_total, tierDiscount);
      const shippingTotal = typeof shipOut?.charge === "number" ? shipOut.charge : pricing.shipping_total;
      const grandTotal = Math.max(0, Math.round((pricing.subtotal - discountTotal + shippingTotal + pricing.tax_total) * 100) / 100);

      const authoritativeNumbers = {
        variant_id: variant.id,
        quantity: parsed.quantity,
        unit_price: variant.price,
        subtotal: pricing.subtotal,
        discount_total: discountTotal,
        shipping_total: shippingTotal,
        tax_total: pricing.tax_total,
        grand_total: grandTotal,
        ...(typeof stockOut?.available_quantity === "number" ? { available_quantity: stockOut.available_quantity } : {}),
      };

      const draft = await generateTextOnlyDraft({
        tenantId,
        workflowId: task.workflow_id,
        taskId: task.id,
        budgetReservationId,
        systemInstruction: "You are a wholesale sales specialist preparing a clear B2B quote summary for the merchant.",
        untrustedFacts: {
          sku: variant.sku,
          city: parsed.city,
          tier_discount_percent: tier?.discountPercent ?? 0,
          ...authoritativeNumbers,
        },
        signal,
      });

      const artifact = saveArtifact(
        tenantId,
        task.workflow_id,
        task.id,
        "QUOTE_PROPOSAL",
        `Wholesale Quote (${variant.sku} x${parsed.quantity})`,
        { draft_text: draft.text, authoritative_numbers: authoritativeNumbers, currency: "BDT", demo: draft.demo },
        task.agent_type
      );

      return {
        draft_type: "WHOLESALE_QUOTE",
        artifact_id: artifact.id,
        variant_id: variant.id,
        authoritative_numbers: authoritativeNumbers,
        draft_text: draft.text,
        demo: draft.demo,
        status: "QUOTE_DRAFTED",
      };
    }

    // =========================================================================
    // PHASE 3: APPROVAL-GATED EFFECT HANDLERS
    // =========================================================================
    // Effect handlers read only task.input: the executor froze it (freezeEffectPayload) before approval, and the
    // approval digest covers it. Nothing here is taken from context or earlier steps at execution time.
    case "OUTBOUND_MESSAGE_APPROVAL": {
      const parsed = parseTaskInput(OutboundMessageApprovalSchema, { ...task.input }, task.task_type);
      if (!parsed.message_text || !parsed.message_text.trim()) {
        throw new AppError("VALIDATION_ERROR", "Outbound message has no approved text.", 400);
      }
      return dispatchOutboundOrSimulate({
        executionContext,
        task,
        conversationId: parsed.conversation_id,
        customerId: parsed.customer_id,
        messageText: parsed.message_text,
        forceSimulate: parsed.simulate,
      });
    }

    case "APPROVAL_REFUND_DISBURSEMENT": {
      const parsed = parseTaskInput(ApprovalRefundDisbursementSchema, { ...task.input }, task.task_type);
      if (parsed.amount === undefined) {
        throw new AppError("VALIDATION_ERROR", "Refund has no approved amount.", 400);
      }

      assertNotKilled(tenantId, "WORKFLOW", task.workflow_id);
      assertNotKilled(tenantId, "WORKFLOW", task.task_type);

      assertReturnBelongsToOrder(tenantId, parsed.return_id, parsed.order_id);
      // Re-check the ceiling now: another refund may have been recorded since approval.
      const ceiling = await refundableAmount(tenantId, parsed.order_id);
      if (!ceiling || parsed.amount > ceiling.refundable || (parsed.payment_id && parsed.payment_id !== ceiling.paymentId)) {
        throw new AppError(
          "CONFLICT",
          `Refund of ${parsed.amount} BDT is no longer within the refundable amount (${ceiling?.refundable ?? 0} BDT); request a new approval.`,
          409,
        );
      }

      const refund = await ReturnService.processRefund(executionContext, {
        order_id: parsed.order_id,
        return_id: parsed.return_id,
        amount: parsed.amount,
        reason: parsed.reason,
      });

      return {
        refund_id: refund.id,
        order_id: refund.order_id,
        payment_id: refund.payment_id,
        amount: refund.amount,
        currency: refund.currency,
        // ReturnService records the refund; no payment gateway is called. Say so instead of implying money moved:
        // the task's status is "recorded", and the stored refund row's own status is reported separately.
        status: "REFUND_RECORDED",
        record_status: refund.status,
        money_movement: "NOT_PERFORMED",
        settlement: "MANUAL_REQUIRED",
        note: "Refund recorded in CommerceOS. Send the money to the customer through the payment provider (bKash, SSLCommerz, bank) and keep its reference.",
      };
    }

    default:
      throw new AppError("NOT_IMPLEMENTED", `Workflow task '${task.task_type}' has no reviewed typed handler.`, 501);
  }
}
