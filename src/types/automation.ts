/**
 * CommerceOS Phase 6: Automations & n8n Hub Domain Types
 * Comprehensive Domain Types, Protocol Contracts, State Models, and Entities
 */

import { CourierProviderName, DeliveryStatus } from "@/types/commerce";

export type AutomationStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "DISABLED"
  | "FAILED"
  | "ARCHIVED";

export type WorkflowLifecycleStatus =
  | "DRAFT"
  | "TESTING"
  | "APPROVED"
  | "ACTIVE"
  | "PAUSED"
  | "RETIRED";

export type ExecutionMode = "DRY_RUN" | "TEST" | "PRODUCTION";

export type TriggerType = "EVENT" | "WEBHOOK" | "SCHEDULE" | "MANUAL";

export type AutomationCategory =
  | "ORDER"
  | "PAYMENT"
  | "INVENTORY"
  | "SHIPPING"
  | "CUSTOMER"
  | "SOCIAL"
  | "MARKETING"
  | "FINANCE_OPERATIONS";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalRequirement = "NONE" | "RECOMMENDED" | "MANDATORY";

export type CircuitBreakerState = "NORMAL" | "DEGRADED" | "OPEN" | "HALF_OPEN";

export type AutomationExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "SUCCESS"
  | "FAILED"
  | "RETRYING"
  | "DEAD_LETTERED"
  | "CANCELLED";

export type AutomationStepStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type WebhookProvider =
  | "PATHAO"
  | "STEADFAST"
  | "REDX"
  | "PAPERFLY"
  | "ECOURIER"
  | "SUNDARBAN"
  | "BKASH"
  | "NAGAD"
  | "META"
  | "CUSTOM";

export type WebhookSignatureAlgorithm =
  | "HMAC_SHA256"
  | "HMAC_SHA512"
  | "RSA_SHA256"
  | "TOKEN";

export type WebhookDeliveryStatus =
  | "RECEIVED"
  | "VERIFIED"
  | "REJECTED"
  | "PROCESSED";

export type RetryStatus = "PENDING" | "PROCESSING" | "EXHAUSTED" | "RESOLVED";

export type DeadLetterStatus = "UNRESOLVED" | "RETRIED" | "CANCELLED" | "RESOLVED";

export type N8nEnvironment = "DEVELOPMENT" | "STAGING" | "PRODUCTION";

export type N8nInstanceStatus = "ACTIVE" | "PAUSED" | "UNAVAILABLE" | "DECOMMISSIONED";

export type N8nHealthStatus = "HEALTHY" | "DEGRADED" | "FAILING" | "UNKNOWN";

// ============================================================
// 1. CORE AUTOMATION ENTITIES
// ============================================================

export interface AutomationRecord {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  category: AutomationCategory;
  trigger_type: TriggerType;
  workflow_id: string;
  workflow_version_id: string;
  n8n_instance_id?: string;
  enabled: boolean;
  execution_mode: ExecutionMode;
  configuration: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationWorkflow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: AutomationCategory;
  trigger: string;
  version: number;
  status: WorkflowLifecycleStatus;
  n8n_workflow_id?: string;
  n8n_instance_id?: string;
  configuration: Record<string, unknown>;
  risk_level: RiskLevel;
  approval_requirement: ApprovalRequirement;
  created_at: string;
  updated_at: string;
}

export interface AutomationWorkflowVersion {
  id: string;
  tenant_id: string;
  workflow_id: string;
  version_number: number;
  status: WorkflowLifecycleStatus;
  definition: Record<string, unknown>;
  changelog?: string;
  created_at: string;
  activated_at?: string;
}

export interface N8nInstance {
  id: string;
  tenant_id: string;
  name: string;
  base_url: string;
  environment: N8nEnvironment;
  status: N8nInstanceStatus;
  health_status: N8nHealthStatus;
  credential_reference: string;
  workflow_namespace: string;
  latency_ms?: number;
  last_health_check_at?: string;
  workflow_count?: number;
  failure_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  automation_id: string;
  trigger_type: TriggerType;
  event_type?: string;
  cron_expression?: string;
  webhook_path?: string;
  configuration: Record<string, unknown>;
  created_at: string;
}

export interface AutomationExecution {
  id: string;
  tenant_id: string;
  automation_id: string;
  workflow_version_id: string;
  trigger_event_id?: string;
  n8n_execution_id?: string;
  status: AutomationExecutionStatus;
  execution_mode: ExecutionMode;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  error_code?: string;
  error_message_reference?: string;
  correlation_id: string;
  causation_id?: string;
  idempotency_key: string;
  input_payload_reference?: string;
  output_result_reference?: string;
  created_at: string;
}

export interface AutomationExecutionStep {
  id: string;
  execution_id: string;
  step_name: string;
  step_type: string;
  status: AutomationStepStatus;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  provider?: string;
  error_code?: string;
  metadata?: Record<string, unknown>;
}

export interface IdempotencyRecord {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  operation: string;
  request_hash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response_data?: Record<string, unknown>;
  response_reference?: string;
  created_at: string;
  expires_at: string;
}

export interface AutomationRetry {
  id: string;
  tenant_id: string;
  automation_id: string;
  execution_id: string;
  attempt_number: number;
  max_attempts: number;
  next_retry_at: string;
  delay_ms: number;
  error_code?: string;
  last_error?: string;
  status: RetryStatus;
  created_at: string;
  updated_at: string;
}

export interface AutomationDeadLetter {
  id: string;
  tenant_id: string;
  automation_id: string;
  workflow_id: string;
  execution_id: string;
  event: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    stack_reference?: string;
  };
  attempt_count: number;
  last_attempt: string;
  correlation_id: string;
  causation_id?: string;
  status: DeadLetterStatus;
  timestamp: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
}

export interface AutomationWebhook {
  id: string;
  tenant_id: string;
  provider: WebhookProvider;
  endpoint_path: string;
  secret_reference: string;
  signature_algorithm: WebhookSignatureAlgorithm;
  is_active: boolean;
  last_event_at?: string;
  failure_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationWebhookDelivery {
  id: string;
  tenant_id: string;
  webhook_id: string;
  provider: WebhookProvider;
  provider_event_id?: string;
  signature?: string;
  status: WebhookDeliveryStatus;
  failure_reason?: string;
  payload_size_bytes: number;
  timestamp: string;
}

export interface AutomationAuditRecord {
  id: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface AutomationHealth {
  tenant_id: string;
  overall_status: "HEALTHY" | "DEGRADED" | "FAILING" | "PAUSED" | "UNKNOWN";
  active_automations_count: number;
  executions_today: number;
  success_rate: number;
  failure_rate: number;
  retry_count: number;
  dead_letter_count: number;
  average_duration_ms: number;
  queue_depth: number;
  provider_health: Record<string, "HEALTHY" | "DEGRADED" | "UNAVAILABLE">;
  n8n_health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  webhook_success_rate: number;
  last_successful_execution_at?: string;
  last_failed_execution_at?: string;
  kill_switch_active: boolean;
  kill_switch_reason?: string;
}

// ============================================================
// 2. 39 STANDARD WORKFLOW TEMPLATE SPECIFICATION
// ============================================================

export interface StandardWorkflowTemplate {
  id: string;
  code: string;
  name: string;
  category: AutomationCategory;
  description: string;
  trigger_type: TriggerType;
  trigger_event?: string;
  cron_schedule?: string;
  required_permissions: string[];
  required_integrations: string[];
  configuration_schema: Record<string, unknown>;
  risk_level: RiskLevel;
  approval_requirement: ApprovalRequirement;
  supported_channels: string[];
  retry_policy: {
    max_attempts: number;
    initial_delay_ms: number;
    backoff_multiplier: number;
  };
  failure_policy: {
    alert_channels: string[];
    fallback_action?: string;
  };
  n8n_workflow_file: string;
  version: string;
}

// ============================================================
// 3. CANONICAL COURIER DOMAIN INTERFACES
// ============================================================

export interface CourierTrackingResult {
  tracking_number: string;
  courier_provider: CourierProviderName;
  raw_provider_status: string;
  canonical_status: DeliveryStatus;
  status_details?: string;
  location?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CourierProviderAdapter {
  provider: CourierProviderName;
  createShipment(tenantId: string, payload: Record<string, unknown>): Promise<{ consignment_id: string; tracking_number: string }>;
  cancelShipment(tenantId: string, trackingNumber: string): Promise<boolean>;
  trackShipment(tenantId: string, trackingNumber: string): Promise<CourierTrackingResult>;
  getRates(tenantId: string, params: { weight_kg: number; destination_district: string }): Promise<{ rate: number; currency: string; estimated_days: number }>;
  validateAddress(tenantId: string, address: Record<string, unknown>): Promise<{ valid: boolean; normalized_address?: string; warnings?: string[] }>;
  handleWebhook(tenantId: string, rawPayload: Record<string, unknown>, headers: Record<string, string>): Promise<CourierTrackingResult>;
}
