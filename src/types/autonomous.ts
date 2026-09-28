/**
 * CommerceOS Phase 10: Autonomous Commerce Platform
 * Comprehensive Domain Types for the convergence layer unifying all 9 prior phases
 * under one coherent autonomous loop: Observe → Understand → Predict → Plan →
 * Simulate → Decide → Authorize → Execute → Verify → Learn → Optimize → Operate.
 */

import { AgentType } from "@/types/ai";
import { ActionRiskLevel, AutonomyLevel } from "@/types/orchestration";

// ============================================================
// 1. BUSINESS OBJECTIVES & HIERARCHY (§6–§8)
// ============================================================

export type ObjectiveHierarchyLevel =
  | "ENTERPRISE"
  | "BUSINESS_UNIT"
  | "BRAND"
  | "STORE"
  | "DOMAIN"
  | "WORKFLOW"
  | "AGENT_TASK";

export type ObjectiveStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "AT_RISK"
  | "PAUSED"
  | "COMPLETED"
  | "ABANDONED";

export interface BusinessObjective {
  id: string;
  tenant_id: string;
  organization_id?: string;
  parent_objective_id?: string;
  hierarchy_level: ObjectiveHierarchyLevel;
  scope_entity_id?: string; // brand_id, store_id, etc.
  name: string;
  description: string;
  status: ObjectiveStatus;
  target_metric: string;
  target_value: number;
  current_value: number;
  baseline_value: number;
  unit: string;
  time_horizon_start: string;
  time_horizon_end: string;
  priority: number; // 1 = highest
  risk_tolerance: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  budget_allocated_bdt: number;
  budget_spent_bdt: number;
  allowed_domains: string[];
  allowed_actions: string[];
  required_approvals: string[];
  constraints: ObjectiveConstraint[];
  progress_percent: number;
  forecast_achievement_percent: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ObjectiveConstraint {
  type: "BUDGET" | "MARGIN" | "RISK" | "TIME" | "INVENTORY" | "APPROVAL" | "POLICY" | "CUSTOM";
  name: string;
  operator: "MIN" | "MAX" | "EQUALS" | "BETWEEN" | "NOT_EXCEEDS";
  value: number;
  unit?: string;
  description?: string;
}

export interface ObjectiveTarget {
  id: string;
  objective_id: string;
  metric_name: string;
  target_value: number;
  current_value: number;
  unit: string;
  measurement_frequency: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";
  status: "ON_TRACK" | "AT_RISK" | "BEHIND" | "EXCEEDED";
}

export interface ObjectiveRun {
  id: string;
  tenant_id: string;
  objective_id: string;
  strategy_id?: string;
  run_type: "EVALUATION" | "STRATEGY_EXECUTION" | "OPTIMIZATION" | "REVIEW";
  status: "RUNNING" | "COMPLETED" | "FAILED";
  started_at: string;
  completed_at?: string;
  findings: Record<string, unknown>;
  recommendations: string[];
  actions_taken: string[];
}

export interface ObjectiveOutcome {
  id: string;
  tenant_id: string;
  objective_id: string;
  run_id: string;
  metric_name: string;
  before_value: number;
  after_value: number;
  change_percent: number;
  attribution: string;
  confidence: number;
  measured_at: string;
}

// ============================================================
// 2. GLOBAL DECISION ENGINE (§9)
// ============================================================

export type DecisionStatus =
  | "PENDING"
  | "EVALUATING"
  | "SIMULATING"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTING"
  | "VERIFIED"
  | "FAILED"
  | "ROLLED_BACK";

export type DecisionCategory =
  | "PRICING"
  | "INVENTORY"
  | "PROCUREMENT"
  | "MARKETING"
  | "OPERATIONS"
  | "FULFILLMENT"
  | "SUPPORT"
  | "FINANCE"
  | "GROWTH"
  | "CROSS_DOMAIN";

export interface GlobalDecision {
  id: string;
  tenant_id: string;
  organization_id?: string;
  objective_id?: string;
  strategy_id?: string;
  category: DecisionCategory;
  title: string;
  description: string;
  status: DecisionStatus;
  risk_level: ActionRiskLevel;
  context: DecisionContext;
  options: DecisionOption[];
  selected_option_id?: string;
  constraints: DecisionConstraint[];
  simulation_results?: DecisionSimulation;
  risk_assessment?: DecisionRisk;
  policy_evaluation?: DecisionPolicyResult;
  outcome?: DecisionOutcomeRecord;
  requires_approval: boolean;
  approved_by?: string;
  approved_at?: string;
  rejected_reason?: string;
  initiated_by: string; // agent_type or user_id
  initiated_at: string;
  decided_at?: string;
  executed_at?: string;
  verified_at?: string;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionContext {
  domains_involved: string[];
  agents_involved: AgentType[];
  current_state: Record<string, unknown>;
  trigger: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidence: Record<string, unknown>[];
}

export interface DecisionOption {
  id: string;
  name: string;
  description: string;
  actions: string[];
  expected_outcome: Record<string, unknown>;
  estimated_cost_bdt: number;
  /** null unless estimated from data (FX-30) */
  estimated_revenue_impact_bdt: number | null;
  risk_score: number; // 0–100
  confidence: number; // 0–1
  pros: string[];
  cons: string[];
  tradeoffs: string[];
  simulation_score?: number;
}

export interface DecisionConstraint {
  name: string;
  type: "BUDGET" | "MARGIN" | "INVENTORY" | "TIME" | "POLICY" | "RISK" | "APPROVAL" | "REGULATORY";
  satisfied: boolean;
  value: number;
  threshold: number;
  description?: string;
}

export interface DecisionSimulation {
  simulation_id: string;
  option_id: string;
  scenarios_evaluated: number;
  expected_revenue_bdt: number | null;
  expected_cost_bdt: number;
  expected_margin_percent: number | null;
  risk_score: number;
  confidence: number;
  side_effects: string[];
  simulated_at: string;
}

export interface DecisionRisk {
  overall_risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  risk_factors: Array<{
    factor: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    probability: number;
    mitigation: string;
  }>;
  reversibility: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  blast_radius: string;
}

export interface DecisionPolicyResult {
  allowed: boolean;
  policies_evaluated: string[];
  policy_violations: string[];
  requires_escalation: boolean;
  escalation_reason?: string;
  autonomy_level_required: AutonomyLevel;
}

export interface DecisionOutcomeRecord {
  decision_id: string;
  option_id: string;
  success: boolean;
  actual_revenue_bdt?: number;
  actual_cost_bdt?: number;
  actual_margin_percent?: number;
  verification_status: "PENDING" | "VERIFIED" | "FAILED" | "PARTIAL";
  verification_evidence: Record<string, unknown>;
  measured_at: string;
  learning_candidate_id?: string;
}

// ============================================================
// 3. STRATEGY ENGINE (§21)
// ============================================================

export type StrategyStatus =
  | "DRAFT"
  | "PROPOSED"
  | "SIMULATING"
  | "APPROVED"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "ARCHIVED";

export interface Strategy {
  id: string;
  tenant_id: string;
  organization_id?: string;
  objective_id: string;
  name: string;
  description: string;
  status: StrategyStatus;
  version: number;
  domains_involved: string[];
  plan: StrategyPlan;
  constraints: ObjectiveConstraint[];
  simulation?: StrategySimulation;
  execution?: StrategyExecution;
  outcome?: StrategyOutcome;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StrategyPlan {
  steps: Array<{
    order: number;
    domain: string;
    action: string;
    agent_type?: AgentType;
    parameters: Record<string, unknown>;
    depends_on: number[];
    estimated_duration_ms: number;
  }>;
  expected_duration_ms: number;
  estimated_cost_bdt: number;
}

export interface StrategySimulation {
  simulation_id: string;
  scenarios_tested: number;
  best_case: Record<string, number>;
  worst_case: Record<string, number>;
  expected_case: Record<string, number>;
  risk_score: number | null;
  confidence: number | null;
  recommendation: string;
  simulated_at: string;
}

export interface StrategyExecution {
  started_at: string;
  completed_at?: string;
  steps_completed: number;
  steps_total: number;
  current_step?: number;
  workflow_id?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
}

export interface StrategyOutcome {
  objective_progress_before: number;
  objective_progress_after: number;
  revenue_impact_bdt: number;
  cost_impact_bdt: number;
  margin_impact_percent: number;
  metrics: Record<string, { before: number; after: number; change_percent: number }>;
  lessons_learned: string[];
  measured_at: string;
}

// ============================================================
// 4. CROSS-DOMAIN AGENT PROTOCOL (§10–§12)
// ============================================================

export type AgentConflictResolutionStrategy =
  | "PRIORITY_WINS"
  | "CONSTRAINT_WINS"
  | "NEGOTIATION"
  | "HUMAN_DECIDES"
  | "SIMULATION_DECIDES";

export interface CrossDomainAgentMessage {
  id: string;
  tenant_id: string;
  correlation_id: string;
  from_agent: AgentType;
  to_agent: AgentType;
  message_type: "REQUEST" | "RESPONSE" | "PROPOSAL" | "EVIDENCE" | "CONFLICT" | "ACKNOWLEDGEMENT";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  requires_response: boolean;
  response_deadline_ms?: number;
  parent_message_id?: string;
  created_at: string;
}

export interface AgentProposal {
  id: string;
  tenant_id: string;
  correlation_id: string;
  proposing_agent: AgentType;
  target_agents: AgentType[];
  proposal_type: "ACTION" | "STRATEGY" | "OPTIMIZATION" | "RECOVERY";
  description: string;
  proposed_actions: Array<{
    domain: string;
    action: string;
    parameters: Record<string, unknown>;
    impact_estimate: Record<string, unknown>;
  }>;
  evidence: Record<string, unknown>[];
  votes: Array<{
    agent: AgentType;
    vote: "APPROVE" | "REJECT" | "ABSTAIN" | "COUNTER_PROPOSE";
    reason: string;
    counter_proposal?: Record<string, unknown>;
  }>;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "NEGOTIATING" | "ESCALATED";
  created_at: string;
  resolved_at?: string;
}

export interface AgentConflict {
  id: string;
  tenant_id: string;
  correlation_id: string;
  conflicting_agents: AgentType[];
  conflict_type: "RESOURCE_CONTENTION" | "OBJECTIVE_CONFLICT" | "BUDGET_CONFLICT" | "PRIORITY_CONFLICT" | "DATA_DISAGREEMENT";
  description: string;
  agent_positions: Array<{
    agent: AgentType;
    position: string;
    evidence: Record<string, unknown>;
    priority: number;
  }>;
  resolution_strategy: AgentConflictResolutionStrategy;
  resolution?: {
    winner?: AgentType;
    decision: string;
    rationale: string;
    resolved_by: string;
  };
  status: "DETECTED" | "MEDIATING" | "RESOLVED" | "ESCALATED";
  created_at: string;
  resolved_at?: string;
}

// ============================================================
// 5. UNIFIED COMMERCE CONTEXT (§13)
// ============================================================

export interface UnifiedCommerceContext {
  tenant_id: string;
  organization_id?: string;
  generated_at: string;
  commerce: {
    total_revenue_bdt: number;
    total_orders: number;
    average_order_value_bdt: number;
    active_customers: number;
    /** null: no visit data */
    conversion_rate: number | null;
  };
  inventory: {
    total_skus: number;
    stockout_risk_count: number;
    overstock_count: number;
    inventory_turnover: number | null;
    pending_transfers: number;
  };
  operations: {
    system_mode: "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "COPILOT" | "EMERGENCY_HALTED";
    overall_health_score: number;
    open_exceptions: number;
    sla_compliance_percent: number | null;
    active_workflows: number;
  };
  growth: {
    active_campaigns: number;
    active_journeys: number;
    active_experiments: number;
    /** null: no acquisition spend is recorded */
    customer_acquisition_cost_bdt: number | null;
    /** % of buying customers with 2+ orders; null without buyers */
    repeat_purchase_rate: number | null;
  };
  intelligence: {
    active_forecasts: number;
    open_anomalies: number;
    pending_recommendations: number;
    active_opportunities: number;
    active_risks: number;
  };
  enterprise: {
    total_stores: number;
    total_brands: number;
    healthy_integrations: number;
    degraded_integrations: number;
    pending_incidents: number;
  };
  agents: {
    active_agents: number;
    running_tasks: number;
    pending_approvals: number;
    success_rate_24h: number;
    escalations_24h: number;
  };
  detected_opportunities: string[];
  detected_risks: string[];
}

// ============================================================
// 6. CONTINUOUS LEARNING (§14–§16)
// ============================================================

export type LearningCandidateStatus =
  | "IDENTIFIED"
  | "VALIDATING"
  | "VALIDATED"
  | "SHADOW_TESTING"
  | "CANARY_TESTING"
  | "GOVERNANCE_REVIEW"
  | "APPROVED"
  | "DEPLOYED"
  | "MONITORING"
  | "REJECTED"
  | "ROLLED_BACK";

export type LearningCategory =
  | "MODEL_IMPROVEMENT"
  | "POLICY_IMPROVEMENT"
  | "WORKFLOW_IMPROVEMENT"
  | "PROMPT_IMPROVEMENT"
  | "ROUTING_IMPROVEMENT"
  | "COST_IMPROVEMENT"
  | "ACCURACY_IMPROVEMENT";

export interface LearningCandidate {
  id: string;
  tenant_id: string;
  category: LearningCategory;
  status: LearningCandidateStatus;
  title: string;
  description: string;
  source_decision_id?: string;
  source_workflow_id?: string;
  current_performance: Record<string, number>;
  proposed_improvement: Record<string, number>;
  expected_impact: Record<string, number>;
  evidence: Record<string, unknown>[];
  validation_results?: {
    passed: boolean;
    tests_run: number;
    tests_passed: number;
    safety_score: number | null;
    details: string[];
  };
  shadow_results?: {
    duration_hours: number;
    samples: number;
    accuracy_delta: number;
    cost_delta_bdt: number;
    anomalies: string[];
  };
  canary_results?: {
    traffic_percent: number;
    duration_hours: number;
    error_rate: number;
    latency_p99_ms: number;
    rollback_triggered: boolean;
  };
  governance_review?: {
    reviewer: string;
    approved: boolean;
    conditions: string[];
    reviewed_at: string;
  };
  rollback_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface LearningArtifact {
  id: string;
  candidate_id: string;
  artifact_type: "MODEL_WEIGHTS" | "PROMPT_TEMPLATE" | "POLICY_RULE" | "WORKFLOW_CONFIG" | "ROUTING_TABLE";
  version: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// 7. MODEL GOVERNANCE (§15, §25)
// ============================================================

export type ModelLifecycleStatus =
  | "DEVELOPMENT"
  | "EVALUATION"
  | "APPROVAL"
  | "STAGING"
  | "CANARY"
  | "PRODUCTION"
  | "MONITORING"
  | "RETIRED";

export type ModelType =
  | "LLM"
  | "EMBEDDING"
  | "RERANKING"
  | "CLASSIFICATION"
  | "FORECASTING"
  | "ANOMALY_DETECTION"
  | "RECOMMENDATION"
  | "CUSTOM";

export interface AIModel {
  id: string;
  tenant_id: string;
  name: string;
  model_type: ModelType;
  provider_id: string;
  version: string;
  lifecycle_status: ModelLifecycleStatus;
  capabilities: string[];
  performance_metrics: Record<string, number>;
  cost_per_1k_tokens?: number;
  latency_p50_ms?: number;
  latency_p99_ms?: number;
  quality_score?: number;
  bias_checks?: Array<{ check: string; result: "PASS" | "FAIL" | "WARNING"; details: string }>;
  deployment_status?: {
    deployed_at: string;
    canary_percent?: number;
    rollback_version?: string;
  };
  owner: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ModelEvaluation {
  id: string;
  model_id: string;
  evaluation_type: "ACCURACY" | "LATENCY" | "COST" | "SAFETY" | "BIAS" | "COMPREHENSIVE";
  dataset_name: string;
  dataset_size: number;
  results: Record<string, number>;
  passed: boolean;
  threshold_violations: string[];
  evaluated_at: string;
}

export interface ModelDeployment {
  id: string;
  tenant_id: string;
  model_id: string;
  version: string;
  environment: "STAGING" | "CANARY" | "PRODUCTION";
  canary_percent?: number;
  status: "DEPLOYING" | "ACTIVE" | "DRAINING" | "ROLLED_BACK" | "RETIRED";
  health: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  deployed_at: string;
  rolled_back_at?: string;
  rollback_reason?: string;
}

// ============================================================
// 8. AI PROVIDER ABSTRACTION & ROUTING (§37–§39)
// ============================================================

export type AIProviderStatus = "ACTIVE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";

export interface AIProvider {
  id: string;
  name: string;
  provider_type: "LLM" | "EMBEDDING" | "RERANKING" | "MULTI";
  api_endpoint: string; // sanitized - no secrets
  supported_models: string[];
  capabilities: ("GENERATE" | "EMBED" | "RERANK" | "STREAM" | "FUNCTION_CALLING")[];
  status: AIProviderStatus;
  health_check_url?: string;
  cost_per_1k_input_tokens: number;
  cost_per_1k_output_tokens: number;
  max_tokens: number;
  rate_limit_rpm: number;
  regions: string[];
  data_residency_compliant: boolean;
  last_health_check_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface ModelRoutingPolicy {
  id: string;
  tenant_id: string;
  name: string;
  rules: Array<{
    condition: {
      task_type?: string;
      max_latency_ms?: number;
      max_cost_per_request?: number;
      min_quality_score?: number;
      data_sensitivity?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      region?: string;
    };
    preferred_provider_id: string;
    preferred_model: string;
    fallback_provider_id?: string;
    fallback_model?: string;
  }>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModelFallbackChain {
  id: string;
  tenant_id: string;
  task_type: string;
  chain: Array<{
    order: number;
    provider_id: string;
    model_name: string;
    max_retries: number;
    timeout_ms: number;
  }>;
  degrade_to_human_on_exhaustion: boolean;
  created_at: string;
}

// ============================================================
// 9. AUTONOMY ADAPTATION (§18, §40–§45)
// ============================================================

export type AutonomyRecommendationType =
  | "INCREASE_AUTONOMY"
  | "DECREASE_AUTONOMY"
  | "MAINTAIN_AUTONOMY"
  | "ENABLE_DOMAIN"
  | "DISABLE_DOMAIN";

export interface AutonomyRecommendation {
  id: string;
  tenant_id: string;
  domain: string;
  recommendation_type: AutonomyRecommendationType;
  current_level: AutonomyLevel;
  recommended_level: AutonomyLevel;
  evidence: {
    success_rate: number;
    failure_rate: number;
    financial_impact_bdt: number;
    verification_pass_rate: number | null;
    human_override_rate: number | null;
    sample_size: number;
    period_days: number;
  };
  simulation_result?: {
    expected_improvement: Record<string, number>;
    risk_score: number | null;
    confidence: number | null;
    note?: string;
  };
  status: "PROPOSED" | "SIMULATING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "APPLIED";
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

/** Enumerated list of prohibited autonomous self-modifications (§44) */
export const AUTONOMOUS_SAFETY_BOUNDARIES = [
  "CHANGE_OWN_PERMISSIONS",
  "DISABLE_AUDIT",
  "DISABLE_VERIFICATION",
  "DISABLE_SECURITY_CONTROLS",
  "INCREASE_OWN_BUDGETS",
  "INCREASE_OWN_AUTONOMY",
  "MODIFY_GOVERNANCE_POLICIES",
  "REMOVE_HUMAN_APPROVAL",
  "ACCESS_UNAUTHORIZED_TENANT",
  "ACCESS_UNRESTRICTED_DATABASE",
  "EXECUTE_ARBITRARY_CODE",
  "BYPASS_TOOL_GATEWAY",
  "BYPASS_COMMERCE_CORE",
] as const;
export type AutonomousSafetyBoundary = (typeof AUTONOMOUS_SAFETY_BOUNDARIES)[number];

// ============================================================
// 10. PLATFORM HEALTH & QUALITY (§28, §42, §58)
// ============================================================

export type HealthStatus = "HEALTHY" | "DEGRADED" | "AT_RISK" | "CRITICAL" | "UNKNOWN";

export type HealthDimension =
  | "COMMERCE"
  | "INTELLIGENCE"
  | "GROWTH"
  | "OPERATIONS"
  | "ENTERPRISE"
  | "INTEGRATIONS"
  | "AGENTS"
  | "WORKFLOWS"
  | "MODELS"
  | "DATA"
  | "SECURITY";

export interface PlatformHealth {
  id: string;
  tenant_id: string;
  overall_status: HealthStatus;
  dimensions: Record<HealthDimension, DomainHealthRecord>;
  autonomous_mode: "AUTONOMOUS" | "SEMI_AUTONOMOUS" | "COPILOT" | "EMERGENCY_HALTED";
  /** null: uptime isn't monitored */
  uptime_percent_24h: number | null;
  last_incident_at?: string;
  assessed_at: string;
}

export interface DomainHealthRecord {
  dimension: HealthDimension;
  status: HealthStatus;
  score: number; // 0–100
  indicators: Array<{
    name: string;
    value: number;
    threshold: number;
    status: HealthStatus;
  }>;
  active_issues: number;
  last_checked_at: string;
}

export interface AutonomousQualityScorecard {
  id: string;
  tenant_id: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  period_start: string;
  period_end: string;
  decision_accuracy: number | null;          // 0–1 (null = not measured)
  verification_success_rate: number | null;   // 0–1 (null = not measured)
  policy_compliance_rate: number | null;      // 0–1 (null = not measured)
  exception_recovery_rate: number | null;     // 0–1 (null = not measured)
  human_escalation_rate: number | null;       // 0–1 (null = not measured)
  duplicate_execution_rate: number | null;    // 0–1 (null = not measured)
  false_automation_rate: number | null;       // 0–1 (null = not measured)
  autonomous_action_failure_rate: number | null; // 0–1 (null = not measured)
  forecast_accuracy: number | null;           // 0–1 (null = not measured)
  recommendation_adoption_rate: number | null; // 0–1 (null = not measured)
  objective_achievement_rate: number | null;  // 0–1 (null = not measured)
  cost_efficiency_ratio: number | null; // business_value / automation_cost; null = not measured
  computed_at: string;
}

export interface SLODefinition {
  id: string;
  tenant_id: string;
  name: string;
  service: string;
  indicator: string; // e.g. "api_availability", "event_processing_latency"
  target_value: number;
  target_unit: string;
  measurement_window: "ROLLING_1H" | "ROLLING_24H" | "ROLLING_7D" | "ROLLING_30D";
  error_budget_percent: number;
  error_budget_remaining_percent: number;
  current_value: number;
  status: "MET" | "AT_RISK" | "BREACHED";
  incident_policy_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ErrorBudget {
  id: string;
  slo_id: string;
  tenant_id: string;
  total_budget_minutes: number;
  consumed_minutes: number;
  remaining_percent: number;
  burn_rate: number; // minutes consumed per day
  projected_exhaustion_date?: string;
  status: "HEALTHY" | "WARNING" | "CRITICAL" | "EXHAUSTED";
  period_start: string;
  period_end: string;
}

// ============================================================
// 11. PLATFORM ECONOMICS (§40–§41)
// ============================================================

export interface PlatformCostRecord {
  id: string;
  tenant_id: string;
  period: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";
  period_start: string;
  period_end: string;
  llm_cost_bdt: number;
  tool_execution_cost_bdt: number;
  api_cost_bdt: number;
  workflow_cost_bdt: number;
  infrastructure_cost_bdt: number;
  provider_cost_bdt: number;
  integration_cost_bdt: number;
  total_cost_bdt: number;
  total_revenue_bdt: number;
  cost_per_order_bdt: number;
  cost_per_autonomous_decision_bdt: number;
  cost_per_workflow_bdt: number;
  cost_per_resolved_exception_bdt: number;
  ai_cost_per_customer_bdt: number;
  business_value_generated_bdt: number;
  cost_efficiency_ratio: number; // value / cost
  breakdown_by_agent: Record<string, number>;
  breakdown_by_domain: Record<string, number>;
  breakdown_by_model: Record<string, number>;
  computed_at: string;
}

// ============================================================
// 12. DATA RESIDENCY & GLOBAL INFRASTRUCTURE (§31–§36)
// ============================================================

export type DataRegionCode = "BD" | "SG" | "US_EAST" | "EU_WEST" | "GLOBAL";

export interface DataResidencyPolicy {
  id: string;
  tenant_id: string;
  organization_id?: string;
  name: string;
  region: DataRegionCode;
  data_classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  storage_requirement: "LOCAL_ONLY" | "REGIONAL" | "GLOBAL_ALLOWED";
  allowed_transfer_regions: DataRegionCode[];
  pii_handling: "ENCRYPT_AT_REST" | "MASK" | "ANONYMIZE" | "PROHIBIT_TRANSFER";
  retention_days: number;
  audit_required: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GlobalEventEnvelope {
  event_id: string;
  event_type: string;
  version: string;
  organization_id?: string;
  tenant_id: string;
  region: DataRegionCode;
  aggregate_type: string;
  aggregate_id: string;
  timestamp: string;
  correlation_id: string;
  causation_id?: string;
  idempotency_key: string;
  partition_key: string;
  payload: Record<string, unknown>;
  metadata: {
    source: string;
    agent_type?: AgentType;
    workflow_id?: string;
    decision_id?: string;
  };
  replay_safe: boolean;
  dead_lettered: boolean;
  dead_letter_reason?: string;
  retention_until: string;
}

export interface AgentRoutingCriteria {
  tenant_id: string;
  region?: DataRegionCode;
  required_capabilities: string[];
  data_residency_required?: DataRegionCode;
  max_latency_ms?: number;
  max_cost_per_request?: number;
  preferred_agents?: AgentType[];
  excluded_agents?: AgentType[];
  policy_constraints?: string[];
}

// ============================================================
// 13. AUTONOMOUS ROLLBACK (§30)
// ============================================================

export type RollbackType =
  | "CONFIGURATION"
  | "PRICING"
  | "CAMPAIGN"
  | "WORKFLOW"
  | "INTEGRATION"
  | "MODEL"
  | "POLICY";

export interface RollbackAction {
  id: string;
  tenant_id: string;
  rollback_type: RollbackType;
  target_entity_id: string;
  target_entity_type: string;
  previous_state: Record<string, unknown>;
  current_state: Record<string, unknown>;
  is_reversible: boolean;
  compensating_action?: string;
  status: "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED";
  initiated_by: string;
  initiated_at: string;
  completed_at?: string;
  verification_result?: {
    verified: boolean;
    evidence: Record<string, unknown>;
  };
}

// ============================================================
// 14. EXTENSIONS & PLUGINS (§63–§64)
// ============================================================

export type PluginLifecycleStatus =
  | "DISCOVERED"
  | "REVIEW"
  | "INSTALLED"
  | "CONFIGURED"
  | "TESTED"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "REMOVED";

export interface Extension {
  id: string;
  tenant_id: string;
  name: string;
  extension_type: "AGENT" | "TOOL" | "INTEGRATION" | "MODEL" | "WORKFLOW" | "REPORT" | "METRIC" | "PROVIDER" | "CHANNEL";
  version: string;
  description: string;
  permissions: string[];
  capabilities: string[];
  dependencies: string[];
  data_access: string[];
  events_emitted: string[];
  events_consumed: string[];
  configuration: Record<string, unknown>;
  lifecycle_status: PluginLifecycleStatus;
  installed_at?: string;
  approved_at?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Plugin {
  id: string;
  tenant_id: string;
  name: string;
  vendor: string;
  version: string;
  description: string;
  category: string;
  permissions_required: string[];
  data_access_required: string[];
  lifecycle_status: PluginLifecycleStatus;
  configuration: Record<string, unknown>;
  health: HealthStatus;
  usage_metrics: {
    invocations_24h: number;
    errors_24h: number;
    avg_latency_ms: number;
  };
  installed_by?: string;
  installed_at?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 15. AUTONOMOUS BUSINESS WORKFLOWS (§22)
// ============================================================

export type AutonomousWorkflowType =
  | "DEMAND_SURGE_RESPONSE"
  | "INVENTORY_CRISIS_RECOVERY"
  | "PROFIT_OPTIMIZATION"
  | "CUSTOMER_RETENTION_RECOVERY"
  | "OPERATIONAL_CRISIS_MANAGEMENT"
  | "ENTERPRISE_EXPANSION"
  | "DAILY_CYCLE"
  | "WEEKLY_CYCLE"
  | "MONTHLY_CYCLE"
  | "CUSTOM";

export interface AutonomousWorkflowRun {
  id: string;
  tenant_id: string;
  workflow_type: AutonomousWorkflowType;
  objective_id?: string;
  strategy_id?: string;
  trigger: string;
  status: "OBSERVING" | "UNDERSTANDING" | "PREDICTING" | "PLANNING" | "SIMULATING" | "EVALUATING_RISK" | "POLICY_CHECK" | "AWAITING_APPROVAL" | "EXECUTING" | "VERIFYING" | "MEASURING" | "LEARNING" | "OPTIMIZING" | "COMPLETED" | "FAILED" | "PAUSED" | "ROLLED_BACK";
  current_loop_step: string;
  agents_involved: AgentType[];
  domains_involved: string[];
  decisions_made: string[];
  actions_executed: string[];
  checkpoints: Array<{
    step: string;
    state: Record<string, unknown>;
    checkpointed_at: string;
  }>;
  outcome?: {
    success: boolean;
    metrics: Record<string, { before: number; after: number }>;
    learning_candidates: string[];
    duration_ms: number;
  };
  started_at: string;
  completed_at?: string;
  correlation_id: string;
}

// ============================================================
// 16. n8n WEBHOOK EVENT TYPES (§61)
// ============================================================

export type N8nAutonomousEventType =
  | "autonomous.objective.created"
  | "autonomous.objective.completed"
  | "autonomous.objective.at_risk"
  | "autonomous.decision.pending_approval"
  | "autonomous.decision.approved"
  | "autonomous.decision.rejected"
  | "autonomous.decision.executed"
  | "autonomous.strategy.activated"
  | "autonomous.strategy.completed"
  | "autonomous.workflow.started"
  | "autonomous.workflow.completed"
  | "autonomous.workflow.failed"
  | "autonomous.learning.candidate_identified"
  | "autonomous.learning.deployed"
  | "autonomous.learning.rolled_back"
  | "autonomous.health.degraded"
  | "autonomous.health.critical"
  | "autonomous.incident.detected"
  | "autonomous.incident.resolved"
  | "autonomous.budget.warning"
  | "autonomous.budget.exceeded"
  | "autonomous.safety.boundary_triggered"
  | "autonomous.cycle.daily_completed"
  | "autonomous.cycle.weekly_completed"
  | "autonomous.cycle.monthly_completed";

export interface N8nAutonomousWebhookPayload {
  event_type: N8nAutonomousEventType;
  event_id: string;
  tenant_id: string;
  organization_id?: string;
  timestamp: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  metadata: {
    source_agent?: AgentType;
    source_workflow?: string;
    source_decision?: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
  };
}

// ============================================================
// 17. CHAOS & LOAD TESTING (§54–§55)
// ============================================================

export type ChaosTestType =
  | "PROVIDER_FAILURE"
  | "DATABASE_LATENCY"
  | "NETWORK_PARTITION"
  | "AGENT_FAILURE"
  | "MODEL_FAILURE"
  | "WORKFLOW_TIMEOUT"
  | "INTEGRATION_DISCONNECT"
  | "BUDGET_EXHAUSTION"
  | "CONCURRENT_MUTATIONS";

export interface ChaosTestScenario {
  id: string;
  tenant_id: string;
  name: string;
  test_type: ChaosTestType;
  description: string;
  target_component: string;
  fault_injection: {
    type: string;
    duration_ms: number;
    intensity: "LOW" | "MEDIUM" | "HIGH";
    parameters: Record<string, unknown>;
  };
  expected_behavior: string;
  success_criteria: Array<{
    metric: string;
    operator: "LESS_THAN" | "GREATER_THAN" | "EQUALS";
    threshold: number;
  }>;
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ABORTED";
  results?: {
    recovery_time_ms: number;
    data_loss: boolean;
    cascading_failures: string[];
    user_impact: string;
    passed_criteria: number;
    total_criteria: number;
  };
  executed_at?: string;
  created_at: string;
}

export interface LoadTestScenario {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  target_endpoint: string;
  concurrency: number;
  duration_seconds: number;
  ramp_up_seconds: number;
  requests_per_second: number;
  payload_template: Record<string, unknown>;
  success_criteria: {
    max_p50_latency_ms: number;
    max_p99_latency_ms: number;
    max_error_rate_percent: number;
    min_throughput_rps: number;
  };
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ABORTED";
  results?: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
    throughput_rps: number;
    error_rate_percent: number;
  };
  executed_at?: string;
  created_at: string;
}

// ============================================================
// 18. METRIC DATA CLASSIFICATION (§68)
// ============================================================

export type MetricDataSource =
  | "REAL"
  | "FORECAST"
  | "SIMULATED"
  | "RECOMMENDED"
  | "AUTONOMOUS"
  | "ESTIMATED";

export interface TaggedMetric {
  name: string;
  value: number;
  unit: string;
  source: MetricDataSource;
  confidence?: number;
  as_of: string;
}
