/**
 * CommerceOS Phase 8: Autonomous Commerce Operations
 * Comprehensive Domain Types, Protocol Contracts, State Models, and Entities
 */

import { AgentType } from "@/types/ai";
import { ActionRiskLevel, AutonomyLevel } from "@/types/orchestration";
import { CourierProviderName, PaymentMethod, PaymentStatus, OrderStatus } from "@/types/commerce";

// ============================================================
// 1. OPERATIONAL STATE & DIGITAL TWIN
// ============================================================

export interface OperationalMetric {
  name: string;
  value: number;
  unit: string;
  status: "OPTIMAL" | "NORMAL" | "WARNING" | "CRITICAL";
  trend: "UP" | "DOWN" | "STABLE";
  change_percent: number;
}

export interface OperationalDomainSummary {
  domain: string;
  status: "HEALTHY" | "ATTENTION_REQUIRED" | "CRITICAL";
  active_tasks_count: number;
  open_exceptions_count: number;
  sla_compliance_percent: number;
  last_automated_action?: string;
  metrics: Record<string, number | string>;
}

export interface OperationalDigitalTwin {
  tenant_id: string;
  generated_at: string;
  overall_health_score: number; // 0 to 100
  system_mode: "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "COPILOT" | "EMERGENCY_HALTED";
  domains: {
    inventory: OperationalDomainSummary;
    procurement: OperationalDomainSummary;
    pricing: OperationalDomainSummary;
    orders: OperationalDomainSummary;
    fulfillment: OperationalDomainSummary;
    shipping: OperationalDomainSummary;
    payments: OperationalDomainSummary;
    finance: OperationalDomainSummary;
    support: OperationalDomainSummary;
    returns: OperationalDomainSummary;
  };
  summary_metrics: {
    inventory_items_at_risk: number;
    pending_purchase_orders_value_bdt: number;
    active_price_adjustments_24h: number;
    orders_at_sla_risk: number;
    shipment_delay_count: number;
    unreconciled_payments_bdt: number;
    open_exceptions_count: number;
    pending_approvals_count: number;
    budget_used_today_percent: number;
  };
  provider_health: Record<string, ProviderStatus>;
}

// ============================================================
// 2. PROCUREMENT OPERATIONS
// ============================================================

export type PurchaseOrderStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "SENT"
  | "ACKNOWLEDGED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  code: string; // e.g. "SUP-DHAKA-01"
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  lead_time_days: number;
  payment_terms: "COD" | "NET_15" | "NET_30" | "ADVANCE";
  rating: number; // 1.0 to 5.0
  is_allowlisted: boolean;
  min_order_value_bdt: number;
  status: "ACTIVE" | "SUSPENDED";
  created_at: string;
  updated_at: string;
}

export interface SupplierProduct {
  id: string;
  tenant_id: string;
  supplier_id: string;
  product_variant_id: string;
  supplier_sku: string;
  cost_price: number;
  currency: string;
  moq: number; // Minimum Order Quantity
  lead_time_days: number;
  available_stock: number;
  is_preferred: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_variant_id: string;
  sku: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  subtotal: number;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  po_number: string; // e.g. "PO-2026-00041"
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  total_amount: number;
  currency: string;
  expected_delivery_date: string;
  notes?: string;
  approval_id?: string;
  approved_by?: string;
  approved_at?: string;
  sent_at?: string;
  received_at?: string;
  tracking_number?: string;
  created_at: string;
  updated_at: string;
}

export interface ProcurementRecommendation {
  id: string;
  tenant_id: string;
  product_variant_id: string;
  sku: string;
  product_name: string;
  current_stock: number;
  forecasted_demand_30d: number;
  recommended_quantity: number;
  recommended_order_quantity?: number;
  recommended_supplier_id: string;
  supplier_id?: string;
  supplier_name: string;
  unit_cost: number;
  estimated_cost: number;
  reason: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED";
  created_at: string;
}

export interface SupplierPerformance {
  supplier_id: string;
  tenant_id: string;
  supplier_name: string;
  total_orders: number;
  on_time_delivery_rate: number; // 0.0 to 1.0
  fill_rate: number; // 0.0 to 1.0
  defect_rate: number; // 0.0 to 1.0
  average_lead_time_days: number;
  quality_score: number; // 0 to 100
  last_evaluated_at: string;
}

// ============================================================
// 3. PRICING OPERATIONS
// ============================================================

export interface PricingRule {
  id: string;
  tenant_id: string;
  name: string;
  target_category_ids?: string[];
  target_variant_ids?: string[];
  min_margin_percent: number; // e.g. 20 (strict profit safeguard)
  max_price_change_percent: number; // e.g. 15 (max allowed swing per action)
  max_daily_changes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingRecommendation {
  id: string;
  tenant_id: string;
  product_variant_id: string;
  sku: string;
  product_name: string;
  current_price: number;
  cost_price: number;
  recommended_price: number;
  reason: "CLEARANCE" | "DEMAND_SURGE" | "OVERSTOCK" | "COMPETITOR_RESPONSE" | "MARGIN_DEFENSE";
  projected_margin_percent: number;
  projected_demand_delta_percent: number;
  confidence: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED";
  created_at: string;
}

export interface PriceSimulation {
  variant_id: string;
  current_price: number;
  cost_price: number;
  proposed_price: number;
  current_margin_percent: number;
  proposed_margin_percent: number;
  margin_safe: boolean;
  expected_volume_change_percent: number;
  projected_revenue_impact_bdt: number;
  projected_profit_impact_bdt: number;
  warnings: string[];
}

export interface PriceChangeRequest {
  id: string;
  tenant_id: string;
  product_variant_id: string;
  sku: string;
  old_price: number;
  new_price: number;
  margin_percent: number;
  reason: string;
  scheduled_at?: string;
  approval_id?: string;
  status: "PENDING_APPROVAL" | "SCHEDULED" | "EXECUTED" | "REJECTED" | "ROLLED_BACK";
  created_at: string;
  executed_at?: string;
  rollback_price?: number;
}

export interface PriceChangeExecution {
  id: string;
  tenant_id: string;
  request_id: string;
  product_variant_id: string;
  old_price: number;
  new_price: number;
  executed_at: string;
  status: "SUCCESS" | "FAILED" | "ROLLED_BACK";
  rollback_price?: number;
  rolled_back_at?: string;
  audit_id: string;
}

// ============================================================
// 4. FULFILLMENT & COURIER OPERATIONS
// ============================================================

export type ShipmentExceptionType =
  | "DELAYED_TRANSIT"
  | "DELIVERY_ATTEMPT_FAILED"
  | "RETURN_TO_ORIGIN"
  | "LOST_PACKAGE"
  | "WRONG_ADDRESS"
  | "COURIER_OUTAGE";

export interface ShipmentException {
  id: string;
  tenant_id: string;
  shipment_id: string;
  order_id: string;
  tracking_number: string;
  courier_provider: CourierProviderName;
  exception_type: ShipmentExceptionType;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: string;
  status: "DETECTED" | "INVESTIGATING" | "RECOVERY_PLANNED" | "RESOLVED" | "ESCALATED";
  recovery_action_taken?: string;
  alternative_courier?: CourierProviderName;
  detected_at: string;
  resolved_at?: string;
}

export interface CourierPerformance {
  courier_provider: CourierProviderName;
  tenant_id: string;
  delivery_success_rate: number; // 0.0 to 1.0
  average_delivery_hours: number;
  return_rate: number;
  active_shipments_count: number;
  cost_per_kg_bdt: number;
  is_available: boolean;
  rating_score: number;
  last_updated: string;
}

export interface CourierRecommendation {
  order_id: string;
  recommended_courier: CourierProviderName;
  estimated_cost_bdt: number;
  estimated_transit_hours: number;
  reason: string;
  fallback_courier: CourierProviderName;
}

export interface FulfillmentPlan {
  id: string;
  tenant_id: string;
  order_id: string;
  allocated_warehouse_id: string;
  warehouse_name: string;
  assigned_courier: CourierProviderName;
  items_available: boolean;
  picking_priority: "NORMAL" | "HIGH" | "URGENT";
  packing_priority: "NORMAL" | "HIGH" | "URGENT";
  estimated_ship_date: string;
  status: "PLANNED" | "READY_FOR_PICKING" | "PICKED" | "PACKED" | "DISPATCHED";
  created_at: string;
}

// ============================================================
// 5. PAYMENT & FINANCE OPERATIONS
// ============================================================

export type PaymentOperationType = "VERIFY" | "RETRY" | "RECONCILE" | "REFUND" | "TIMEOUT_CHECK";

export interface PaymentOperation {
  id: string;
  tenant_id: string;
  order_id: string;
  payment_id: string;
  operation_type: PaymentOperationType;
  provider: PaymentMethod;
  amount: number;
  transaction_id?: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  error_code?: string;
  retry_count: number;
  created_at: string;
}

export interface PaymentException {
  id: string;
  tenant_id: string;
  payment_id: string;
  order_id: string;
  provider: PaymentMethod;
  amount: number;
  reason: "TRANSACTION_TIMEOUT" | "AMOUNT_MISMATCH" | "DUPLICATE_PAYMENT" | "PROVIDER_API_ERROR";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "ESCALATED";
  resolution_notes?: string;
  created_at: string;
  resolved_at?: string;
}

export interface ReconciliationRun {
  id: string;
  tenant_id: string;
  run_date: string;
  orders_audited_count: number;
  total_revenue_expected_bdt: number;
  total_revenue_collected_bdt: number;
  discrepancies_found_count: number;
  total_discrepancy_amount_bdt: number;
  status: "COMPLETED" | "EXCEPTIONS_FOUND" | "RECONCILED";
  created_at: string;
}

export interface ReconciliationItem {
  id: string;
  run_id: string;
  tenant_id: string;
  order_id: string;
  order_number: string;
  payment_method: PaymentMethod;
  expected_amount: number;
  actual_settled_amount: number;
  variance_amount: number;
  status: "MATCHED" | "DISCREPANCY" | "INVESTIGATING" | "RESOLVED";
  discrepancy_reason?: string;
  resolved_at?: string;
}

export interface FinancialException {
  id: string;
  tenant_id: string;
  category: "COD_DISCREPANCY" | "FEE_ANOMALY" | "UNMATCHED_SETTLEMENT" | "OVER_REFUND" | "MARGIN_EROSION";
  amount_bdt: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  status: "DETECTED" | "INVESTIGATING" | "PROPOSED_ACTION" | "RESOLVED" | "ESCALATED";
  proposed_action?: string;
  resolved_at?: string;
  created_at: string;
}

export interface SettlementRecord {
  id: string;
  tenant_id: string;
  provider: PaymentMethod | CourierProviderName;
  settlement_batch_id: string;
  gross_amount_bdt: number;
  fees_deducted_bdt: number;
  net_disbursed_bdt: number;
  reconciled: boolean;
  settled_at: string;
  created_at: string;
}

// ============================================================
// 6. CUSTOMER SUPPORT OPERATIONS
// ============================================================

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "ESCALATED";

export interface SupportTicket {
  id: string;
  tenant_id: string;
  ticket_number: string; // e.g. "TICK-2026-0089"
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  order_id?: string;
  order_number?: string;
  category: "ORDER_STATUS" | "DELIVERY_DELAY" | "PAYMENT_ISSUE" | "REFUND_REQUEST" | "PRODUCT_INQUIRY" | "COMPLAINT";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: SupportTicketStatus;
  subject: string;
  assigned_agent: AgentType;
  sla_due_at: string;
  is_sla_breached: boolean;
  resolution_summary?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

// ============================================================
// 7. EXCEPTION MANAGEMENT ENGINE
// ============================================================

export type ExceptionDomain =
  | "INVENTORY"
  | "PROCUREMENT"
  | "PRICING"
  | "ORDERS"
  | "FULFILLMENT"
  | "SHIPPING"
  | "PAYMENTS"
  | "FINANCE"
  | "SUPPORT"
  | "RETURNS"
  | "PROVIDER";

export type ExceptionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ExceptionStatus =
  | "DETECTED"
  | "CLASSIFIED"
  | "INVESTIGATING"
  | "ACTION_PROPOSED"
  | "APPROVAL_REQUIRED"
  | "RESOLVING"
  | "VERIFIED"
  | "RESOLVED"
  | "ESCALATED";

export interface OperationalException {
  id: string;
  tenant_id: string;
  domain: ExceptionDomain;
  exception_type: string; // e.g. "STOCKOUT_RISK", "TRANSIT_DELAY", "PAYMENT_MISMATCH"
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  title: string;
  description: string;
  entity_type: "ORDER" | "SHIPMENT" | "PRODUCT" | "PAYMENT" | "SUPPLIER" | "PURCHASE_ORDER" | "TICKET" | "FINANCE";
  entity_id: string;
  evidence: Record<string, unknown>;
  root_cause_hypothesis?: string;
  proposed_action?: {
    action_type: string;
    description: string;
    risk_level: ActionRiskLevel;
    estimated_cost?: number;
    parameters: Record<string, unknown>;
  };
  assigned_agent: AgentType;
  approval_id?: string;
  resolution_notes?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ExceptionPolicy {
  id: string;
  tenant_id: string;
  exception_type: string;
  max_auto_retries: number;
  auto_resolve_allowed: boolean;
  required_autonomy_level: AutonomyLevel;
  human_escalation_threshold_severity: ExceptionSeverity;
  sla_resolution_minutes: number;
}

// ============================================================
// 8. PROVIDER HEALTH & RESILIENCY ENGINE
// ============================================================

export type ProviderType = "PAYMENT_GATEWAY" | "COURIER" | "SMS_GATEWAY" | "COMMUNICATION";

export type ProviderStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" | "UNKNOWN";

export interface ProviderHealth {
  id: string;
  tenant_id: string;
  provider_id: string; // e.g. "steadfast", "pathao", "bkash", "nagad"
  provider_name: string;
  provider_type: ProviderType;
  status: ProviderStatus;
  latency_ms: number;
  success_rate_percent: number;
  consecutive_failures: number;
  circuit_breaker_open: boolean;
  last_checked_at: string;
  failover_provider_id?: string;
  active_incident_id?: string;
}

export interface ProviderIncident {
  id: string;
  tenant_id: string;
  provider_id: string;
  provider_name: string;
  provider_type: ProviderType;
  status: "ACTIVE" | "MITIGATED" | "RESOLVED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  failover_active: boolean;
  started_at: string;
  resolved_at?: string;
}

// ============================================================
// 9. OPERATIONAL SLA ENGINE
// ============================================================

export type SLADomain =
  | "ORDER_FULFILLMENT"
  | "SHIPMENT_DISPATCH"
  | "DELIVERY_TRANSIT"
  | "SUPPORT_FIRST_RESPONSE"
  | "SUPPORT_RESOLUTION"
  | "REFUND_SETTLEMENT"
  | "INVENTORY_REPLENISHMENT";

export interface SLAPolicy {
  id: string;
  tenant_id: string;
  domain: SLADomain;
  target_duration_minutes: number;
  warning_threshold_minutes: number;
  escalation_agent: AgentType;
  enabled: boolean;
  created_at: string;
}

export interface SLABreach {
  id: string;
  tenant_id: string;
  policy_id: string;
  domain: SLADomain;
  entity_type: string;
  entity_id: string;
  target_duration_minutes: number;
  actual_duration_minutes: number;
  status: "WARNING" | "BREACHED" | "RECOVERED";
  detected_at: string;
  recovered_at?: string;
}

export interface SLARisk {
  entity_id: string;
  entity_type: string;
  domain: SLADomain;
  minutes_elapsed: number;
  target_duration_minutes: number;
  breach_probability: number; // 0.0 to 1.0
  recommended_recovery_action: string;
}

// ============================================================
// 10. AUTONOMY BUDGETS & RISK SAFEGUARDS
// ============================================================

export interface AutonomyBudget {
  id: string;
  tenant_id: string;
  daily_max_actions: number;
  daily_max_spend_bdt: number;
  daily_max_llm_cost_usd: number;
  actions_used_today: number;
  spend_used_today_bdt: number;
  llm_cost_used_today_usd: number;
  is_budget_exhausted: boolean;
  emergency_stopped: boolean;
  last_reset_date: string;
  created_at: string;
  updated_at: string;
}

export interface OperationalRisk {
  action_name: string;
  financial_impact_bdt: number;
  customer_impact_score: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reversibility: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  provider_reliability_score: number; // 0.0 to 1.0
  confidence_score: number; // 0.0 to 1.0
  calculated_risk_level: ActionRiskLevel;
  required_controls: string[];
  requires_human_approval: boolean;
}

export interface BulkOperationSafeguard {
  id: string;
  tenant_id: string;
  action_type: string;
  target_entity_type: string;
  total_objects_count: number;
  sample_preview_items: unknown[];
  dry_run_summary: Record<string, unknown>;
  status: "PREVIEW" | "DRY_RUN_COMPLETED" | "PENDING_APPROVAL" | "RUNNING" | "COMPLETED" | "HALTED";
  processed_count: number;
  successful_count: number;
  failed_count: number;
  kill_switch_active: boolean;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}
