/**
 * CommerceOS Phase 5: Multi-Agent Orchestration & Controlled Autonomy
 * Comprehensive Domain Types, Protocol Contracts, and State Models
 */

import { AgentType } from "@/types/ai";

// ============================================================
// 1. WORKFLOW & TASK ENUMS
// ============================================================

export const WorkflowStatus = {
  DRAFT: "DRAFT",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowTriggerType = {
  MANUAL: "MANUAL",
  EVENT: "EVENT",
  SCHEDULE: "SCHEDULE",
  AGENT: "AGENT",
  WEBHOOK: "WEBHOOK",
  SYSTEM: "SYSTEM",
} as const;
export type WorkflowTriggerType = (typeof WorkflowTriggerType)[keyof typeof WorkflowTriggerType];

export const TaskStatus = {
  PENDING: "PENDING",
  READY: "READY",
  RUNNING: "RUNNING",
  WAITING_DEPENDENCY: "WAITING_DEPENDENCY",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  WAITING_HUMAN: "WAITING_HUMAN",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export type TaskState = TaskStatus;
export const TaskState = TaskStatus;

export const TaskPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const ActionRiskLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type ActionRiskLevel = (typeof ActionRiskLevel)[keyof typeof ActionRiskLevel];

export const AutonomyLevel = {
  LEVEL_0_DISABLED: "LEVEL_0_DISABLED",     // No autonomous execution; system is read-only / human executes
  LEVEL_1_COPILOT: "LEVEL_1_COPILOT",       // AI recommends; human manually triggers every action
  LEVEL_2_ASSISTED: "LEVEL_2_ASSISTED",     // AI executes LOW risk; requires approval for MEDIUM/HIGH
  LEVEL_3_CONDITIONAL: "LEVEL_3_CONDITIONAL",// AI executes approved workflows under policy; approval for HIGH/CRITICAL
  LEVEL_4_HIGH: "LEVEL_4_HIGH",             // Enterprise-approved workflows only with bounded limits
} as const;
export type AutonomyLevel = (typeof AutonomyLevel)[keyof typeof AutonomyLevel];

export const ApprovalStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const DelegationStatus = {
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
} as const;
export type DelegationStatus = (typeof DelegationStatus)[keyof typeof DelegationStatus];

export const VerificationMethod = {
  DOMAIN_STATE: "DOMAIN_STATE",          // Direct verification against Commerce Core database records
  TOOL_RESULT: "TOOL_RESULT",            // Verification via authoritative tool query
  EVENT: "EVENT",                        // Confirmed domain event reception
  PROVIDER_CONFIRMATION: "PROVIDER_CONFIRMATION", // Third-party receipt (bKash/Steadfast/Pathao API response)
  RULE: "RULE",                          // Deterministic mathematical invariant check
  LLM_ASSISTED: "LLM_ASSISTED",          // Semantic qualitative verification (fallback only)
} as const;
export type VerificationMethod = (typeof VerificationMethod)[keyof typeof VerificationMethod];

export const VerificationStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  INCONCLUSIVE: "INCONCLUSIVE",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const AgentMessageType = {
  TASK_REQUEST: "TASK_REQUEST",
  TASK_RESULT: "TASK_RESULT",
  TASK_ERROR: "TASK_ERROR",
  TASK_STATUS: "TASK_STATUS",
  APPROVAL_REQUEST: "APPROVAL_REQUEST",
  ESCALATION: "ESCALATION",
  VERIFICATION_REQUEST: "VERIFICATION_REQUEST",
} as const;
export type AgentMessageType = (typeof AgentMessageType)[keyof typeof AgentMessageType];

export const PlanStatus = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

// ============================================================
// 2. CORE WORKFLOW & TASK INTERFACES
// ============================================================

export interface TaskDependency {
  task_id: string;
  required_status?: TaskStatus; // Defaults to COMPLETED
  pass_output_as?: string;      // Key in input payload to map parent output
}

export interface AgentTask {
  id: string;
  tenant_id: string;
  workflow_id: string;
  parent_task_id?: string;
  agent_id: string;
  agent_type: AgentType;
  task_type: string;
  objective: string;
  status: TaskStatus;
  priority: TaskPriority;
  risk_level: ActionRiskLevel;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  dependencies: TaskDependency[];
  assigned_tools: string[];
  attempt_count: number;
  max_attempts: number;
  timeout_ms: number;
  idempotency_key: string;
  approval_id?: string;
  verification_id?: string;
  deadline?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type WorkflowTask = AgentTask;

export interface WorkflowBudget {
  max_tokens: number;
  max_cost_usd: number;
  max_tool_calls: number;
  max_tasks: number;
  max_duration_ms: number;
  used_tokens: number;
  used_cost_usd: number;
  used_tool_calls: number;
}

export interface WorkflowPlanStep {
  task_type: string;
  objective: string;
  agent_type: AgentType;
  dependencies: string[]; // Parent task_types or step keys
  risk_level: ActionRiskLevel;
  required_tools: string[];
  input_schema?: Record<string, unknown>;
}

export interface AgentWorkflow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  trigger_type: WorkflowTriggerType;
  trigger_source?: string;
  trigger_payload?: Record<string, unknown>;
  status: WorkflowStatus;
  objective: string;
  plan: WorkflowPlanStep[];
  tasks: string[]; // Task IDs
  current_step: number;
  total_steps: number;
  budget: WorkflowBudget;
  context_id: string;
  created_by: string; // User ID, Agent Type, or SYSTEM
  created_by_type: "USER" | "AGENT" | "SYSTEM" | "EVENT";
  started_at?: string;
  completed_at?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 3. INTER-AGENT COMMUNICATION & DELEGATION
// ============================================================

export interface AgentMessage {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  sender_agent: AgentType;
  recipient_agent: AgentType;
  message_type: AgentMessageType;
  payload: Record<string, unknown>;
  correlation_id: string;
  created_at: string;
}

export interface AgentDelegation {
  id: string;
  tenant_id: string;
  workflow_id: string;
  parent_task_id: string;
  child_task_id: string;
  source_agent: AgentType;
  target_agent: AgentType;
  required_capability: string;
  reason: string;
  status: DelegationStatus;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// 4. SHARED CONTEXT & ARTIFACTS
// ============================================================

export interface WorkflowArtifact {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  name: string;
  artifact_type:
    | "ORDER_DRAFT"
    | "CUSTOMER_SEGMENT"
    | "INVENTORY_REORDER_PROPOSAL"
    | "REFUND_RECEIPT"
    | "QUOTE_PROPOSAL"
    | "ANALYSIS_SUMMARY"
    | "OUTBOUND_MESSAGE_DRAFT";
  schema_version: string;
  content: Record<string, unknown>;
  is_verified: boolean;
  created_at: string;
}

export interface WorkflowContext {
  id: string;
  tenant_id: string;
  workflow_id: string;
  objective: string;
  customer_id?: string;
  order_id?: string;
  conversation_id?: string;
  relevant_entities: Record<string, unknown>; // e.g. { order_status: "CONFIRMED", items_count: 50 }
  completed_tasks: string[];
  active_tasks: string[];
  artifacts: string[]; // Artifact IDs
  constraints: string[];
  approved_actions: string[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowCheckpoint {
  id: string;
  tenant_id: string;
  workflow_id: string;
  step_index: number;
  status: WorkflowStatus;
  snapshot: {
    workflow: AgentWorkflow;
    tasks: AgentTask[];
    context: WorkflowContext;
    budget: WorkflowBudget;
  };
  reason: string;
  created_at: string;
}

// ============================================================
// 5. CONTROLLED AUTONOMY & APPROVALS
// ============================================================

export interface AutonomyPolicy {
  id: string;
  tenant_id: string;
  agent_type: AgentType;
  workflow_type?: string;
  autonomy_level: AutonomyLevel;
  allowed_tools: string[];
  approval_required_for: ActionRiskLevel[];
  max_actions_per_day: number;
  max_cost_usd_per_day: number;
  max_duration_ms: number;
  allowed_channels: string[];
  is_emergency_stopped: boolean;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  requested_by_agent: AgentType;
  action: string;
  risk_level: ActionRiskLevel;
  target_entity_type: "ORDER" | "CUSTOMER" | "INVENTORY" | "PAYMENT" | "CAMPAIGN" | "MESSAGE";
  target_entity_id: string;
  entity_state_snapshot: Record<string, unknown>; // Entity snapshot at planning time to detect stale state
  payload: Record<string, unknown>;
  reason: string;
  status: ApprovalStatus;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  expires_at: string;
  created_at: string;
}

export interface ActionReceipt {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  action: string;
  actor_agent: AgentType;
  target_entity: string;
  target_id: string;
  status: "SUCCESS" | "FAILED";
  idempotency_key: string;
  provider_reference?: string;
  result: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// 6. VERIFICATION & EVALUATION
// ============================================================

export interface AgentVerification {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  verifier_agent: AgentType;
  method: VerificationMethod;
  status: VerificationStatus;
  target_assertion: string;
  evidence: Record<string, unknown>;
  failure_reason?: string;
  verified_at: string;
  created_at: string;
}

// ============================================================
// 7. TRIGGERS, SCHEDULING & TEMPLATES
// ============================================================

export interface AgentTriggerRule {
  id: string;
  tenant_id: string;
  event_type: string; // e.g. "inventory.low_stock", "payment.failed", "order.delivered"
  conditions: Array<{
    field: string;
    operator: "EQUALS" | "NOT_EQUALS" | "GREATER_THAN" | "LESS_THAN" | "CONTAINS";
    value: unknown;
  }>;
  target_workflow_template_id: string;
  target_agent: AgentType;
  cooldown_seconds: number;
  last_triggered_at?: string;
  max_runs_per_day: number;
  runs_today: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentSchedule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  workflow_template_id: string;
  cron_expression: string; // e.g. "0 9 * * *" (9 AM daily)
  target_agent: AgentType;
  payload?: Record<string, unknown>;
  timezone: string;
  is_active: boolean;
  last_run_at?: string;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTemplate {
  id: string;
  tenant_id: string;
  name: string;
  code: string; // e.g. "ABANDONED_CART_RECOVERY", "LOW_STOCK_RESTOCK", "DELIVERY_EXCEPTION_RESOLVE"
  description: string;
  default_trigger: WorkflowTriggerType;
  steps: WorkflowPlanStep[];
  allowed_agents: AgentType[];
  allowed_tools: string[];
  max_budget: WorkflowBudget;
  risk_level: ActionRiskLevel;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 8. SIMULATION & TELEMETRY
// ============================================================

export interface WorkflowSimulationResult {
  objective: string;
  workflow_code?: string;
  planned_steps: WorkflowPlanStep[];
  required_agents: AgentType[];
  required_tools: string[];
  estimated_cost_usd: number;
  estimated_tokens: number;
  estimated_duration_ms: number;
  approval_points: Array<{
    step: number;
    action: string;
    risk_level: ActionRiskLevel;
    reason: string;
  }>;
  safe_to_execute: boolean;
  warnings: string[];
}
