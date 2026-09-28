/**
 * CommerceOS Phase 6: Commerce Intelligence, Optimization & Decision Engine
 * Domain Types, Enums, Metrics, Evidence, Forecasting, Simulation & Decision Contracts
 */

import { ActionRiskLevel } from "./orchestration";

// ============================================================
// 1. METRIC DEFINITIONS & AGGREGATION CONTRACTS
// ============================================================

export type MetricCategory =
  | "SALES"
  | "PRODUCT"
  | "INVENTORY"
  | "CUSTOMER"
  | "PAYMENT"
  | "DELIVERY"
  | "FINANCIAL"
  | "MARKETING";

export type AggregationType =
  | "SUM"
  | "AVERAGE"
  | "COUNT"
  | "RATE"
  | "RATIO"
  | "PERCENTILE"
  | "LAST_VALUE";

export interface MetricDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  category: MetricCategory;
  formula: string;
  unit: "CURRENCY" | "COUNT" | "PERCENTAGE" | "DAYS" | "RATIO" | "SECONDS";
  currency_sensitive: boolean;
  aggregation_type: AggregationType;
  dimensions: string[];
  version: string;
  status: "ACTIVE" | "DEPRECATED";
  created_at: string;
  updated_at: string;
}

export interface MetricSnapshot {
  id: string;
  tenant_id: string;
  metric_key: string;
  dimension_key?: string;
  dimension_value?: string;
  period_start: string;
  period_end: string;
  granularity: "HOUR" | "DAY" | "WEEK" | "MONTH";
  value: number;
  sample_count: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// 2. ANALYTICS QUERY & TIME-SERIES CONTRACTS
// ============================================================

export type DateRangePreset =
  | "TODAY"
  | "YESTERDAY"
  | "7D"
  | "14D"
  | "30D"
  | "90D"
  | "THIS_MONTH"
  | "PREVIOUS_MONTH"
  | "QUARTER"
  | "YEAR"
  | "CUSTOM";

export type ComparisonPeriodType =
  | "PREVIOUS_PERIOD"
  | "PREVIOUS_YEAR"
  | "ROLLING_AVERAGE"
  | "BASELINE"
  | "NONE";

export interface AnalyticsQuery {
  tenantId: string;
  metrics: string[];
  dimensions?: string[];
  datePreset?: DateRangePreset;
  startDate?: string;
  endDate?: string;
  comparison?: ComparisonPeriodType;
  granularity?: "HOUR" | "DAY" | "WEEK" | "MONTH";
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  timezone?: string;
}

export interface MetricComparisonResult {
  metric_key: string;
  current_value: number;
  comparison_value: number;
  absolute_change: number;
  percentage_change: number;
  trend_direction: "UP" | "DOWN" | "FLAT";
  is_favorable: boolean;
  period_label: string;
  comparison_label: string;
}

export interface AnalyticsQueryResult {
  tenant_id: string;
  date_range: {
    start: string;
    end: string;
    preset?: DateRangePreset;
  };
  metrics: Record<string, MetricComparisonResult>;
  time_series?: Array<{
    timestamp: string;
    metrics: Record<string, number>;
  }>;
  breakdown?: Array<{
    dimension: string;
    value: string;
    metrics: Record<string, number>;
  }>;
  query_version: string;
  executed_at: string;
}

// ============================================================
// 3. EVIDENCE & EXPLAINABILITY SYSTEM
// ============================================================

export interface EvidenceItem {
  id: string;
  source_type: "METRIC" | "ORDER" | "INVENTORY" | "PAYMENT" | "COURIER" | "CUSTOMER" | "LOG";
  source_id: string;
  metric: string;
  value: number | string;
  timestamp: string;
  period?: string;
  comparison?: string;
  confidence: number; // 0.0 to 1.0
  query_version: string;
  description: string;
}

// ============================================================
// 4. INSIGHTS, ANOMALIES, OPPORTUNITIES & RISKS
// ============================================================

export type InsightSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Insight {
  id: string;
  tenant_id: string;
  category: MetricCategory;
  title: string;
  summary: string;
  severity: InsightSeverity;
  evidence: EvidenceItem[];
  possible_drivers: string[];
  affected_entities: Array<{
    type: string;
    id: string;
    name?: string;
  }>;
  impact_summary?: string;
  confidence: number;
  status: "ACTIVE" | "ARCHIVED" | "ACTIONED";
  created_at: string;
  updated_at: string;
}

export interface Anomaly {
  id: string;
  tenant_id: string;
  metric: string;
  detected_at: string;
  period_analyzed: string;
  current_value: number;
  expected_value: number;
  deviation_score: number; // Standard deviations (z-score) or % deviation
  detection_method: "Z_SCORE" | "MOVING_AVERAGE" | "SEASONAL_BASELINE" | "STATIC_THRESHOLD";
  severity: InsightSeverity;
  explanation_status: "EXPLAINED" | "UNEXPLAINED";
  probable_cause?: string;
  evidence: EvidenceItem[];
  affected_entities: Array<{ type: string; id: string; name?: string }>;
  created_at: string;
}

export interface Opportunity {
  id: string;
  tenant_id: string;
  type:
    | "RISING_PRODUCT"
    | "RESTOCK_DEMAND"
    | "REPEAT_BUYER_CAMPAIGN"
    | "CART_RECOVERY"
    | "MARGIN_OPTIMIZATION"
    | "REGIONAL_EXPANSION";
  title: string;
  description: string;
  evidence: EvidenceItem[];
  affected_entities: Array<{ type: string; id: string; name?: string }>;
  estimated_impact: {
    potential_revenue_bdt?: number;
    potential_margin_bdt?: number;
    potential_orders?: number;
    timeframe_days: number;
  };
  confidence: number; // 0.0 to 1.0
  priority: "LOW" | "MEDIUM" | "HIGH";
  expires_at: string;
  status: "OPEN" | "DISMISSED" | "RECOMMENDED" | "EXECUTED";
  created_at: string;
}

export interface Risk {
  id: string;
  tenant_id: string;
  type:
    | "STOCKOUT"
    | "OVERSTOCK"
    | "PAYMENT_GATEWAY_DOWN"
    | "HIGH_RETURN_RATE"
    | "DELIVERY_BOTTLENECK"
    | "CHURN_ACCELERATION"
    | "REVENUE_CONTRACTION";
  title: string;
  description: string;
  severity: InsightSeverity;
  probability: number; // 0.0 to 1.0
  evidence: EvidenceItem[];
  affected_entities: Array<{ type: string; id: string; name?: string }>;
  recommended_mitigation: string;
  confidence: number;
  created_at: string;
}

// ============================================================
// 5. FORECASTING & MODEL REGISTRY CONTRACTS
// ============================================================

export type ForecastHorizon = "7D" | "14D" | "30D" | "90D";

export interface ForecastPoint {
  date: string;
  predicted_value: number;
  confidence_lower: number;
  confidence_upper: number;
}

export interface ForecastEvaluation {
  mae: number;  // Mean Absolute Error
  rmse: number; // Root Mean Squared Error
  mape: number; // Mean Absolute Percentage Error (%)
  wape: number; // Weighted Absolute Percentage Error (%)
  sample_size: number;
  evaluated_at: string;
}

export interface ForecastRun {
  id: string;
  tenant_id: string;
  target_type: "DEMAND" | "SALES_REVENUE" | "ORDER_VOLUME" | "INVENTORY_DEPLETION";
  entity_id?: string; // Product Variant ID, Category, etc.
  horizon: ForecastHorizon;
  model_name: string;
  model_version: string;
  prediction_interval: number; // e.g. 0.95 for 95% interval
  historical_baseline_value: number;
  predicted_points: ForecastPoint[];
  aggregate_prediction: number;
  confidence_score: number;
  status: "COMPLETED" | "INSUFFICIENT_DATA" | "FAILED";
  insufficient_data_reason?: string;
  evaluation?: ForecastEvaluation;
  generated_at: string;
}

export interface ModelRegistryEntry {
  id: string;
  name: string;
  version: string;
  type: "FORECASTING" | "ANOMALY_DETECTION" | "SEGMENTATION" | "ELASTICITY";
  artifact_uri: string;
  feature_version: string;
  training_window_start?: string;
  training_window_end?: string;
  status: "TRAINING" | "VALIDATING" | "READY" | "DEPLOYED" | "DEPRECATED";
  metrics: Record<string, number>;
  limitations: string[];
  created_at: string;
  updated_at: string;
}

// ============================================================
// 6. WHAT-IF SIMULATION & SCENARIO MODELING
// ============================================================

export type SimulationScenarioType = "BASELINE" | "OPTIMISTIC" | "CONSERVATIVE" | "CUSTOM";

export interface SimulationInput {
  price_change_pct?: number;        // e.g. +5 or -10
  cost_change_pct?: number;         // e.g. COGS fluctuation
  inventory_allocation_units?: number; // e.g. +500
  shipping_fee_change_bdt?: number; // e.g. 120 -> 100
  discount_rate_change_pct?: number; // e.g. +5% coupon
  marketing_budget_change_bdt?: number;
  target_entity_type?: "PRODUCT" | "CATEGORY" | "ALL";
  target_entity_id?: string;
  time_horizon_days: number;
}

export interface SimulationMetricDelta {
  metric: string;
  baseline: number;
  simulated: number;
  delta_absolute: number;
  delta_percentage: number;
  unit: string;
}

export interface SimulationResult {
  id: string;
  tenant_id: string;
  scenario_name: string;
  scenario_type: SimulationScenarioType;
  inputs: SimulationInput;
  baseline_metrics: Record<string, number>;
  simulated_metrics: Record<string, number>;
  deltas: SimulationMetricDelta[];
  assumptions: string[];
  uncertainty_range_pct: number;
  expected_roi_bdt?: number;
  model_version: string;
  simulated_at: string;
}

// ============================================================
// 7. RECOMMENDATION & DECISION ENGINE CONTRACTS
// ============================================================

export type RecommendationStatus =
  | "PROPOSED"
  | "REVIEWING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTED"
  | "VERIFIED"
  | "FAILED";

export interface Recommendation {
  id: string;
  tenant_id: string;
  type:
    | "ADJUST_PRICE"
    | "REORDER_STOCK"
    | "RUN_CART_RECOVERY"
    | "DISCOUNT_DEAD_STOCK"
    | "CHANGE_DEFAULT_COURIER"
    | "PAUSE_UNDERPERFORMING_CAMPAIGN"
    | "VIP_CUSTOMER_OUTREACH";
  title: string;
  description: string;
  rationale: string;
  evidence: EvidenceItem[];
  affected_entities: Array<{
    type: string;
    id: string;
    name?: string;
    current_state?: Record<string, unknown>;
  }>;
  expected_benefit: {
    revenue_impact_bdt?: number;
    cost_saving_bdt?: number;
    order_gain?: number;
    summary: string;
  };
  expected_cost: {
    financial_cost_bdt?: number;
    operational_complexity: "LOW" | "MEDIUM" | "HIGH";
  };
  confidence: number;
  assumptions: string[];
  risks: string[];
  what_would_change_this: string[];
  required_autonomy_level: number; // 0 to 4
  action_risk_level: ActionRiskLevel;
  required_approval: boolean;
  expires_at: string;
  status: RecommendationStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  dispatched_workflow_id?: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionRequest {
  id: string;
  tenant_id: string;
  recommendation_id?: string;
  objective: string;
  context: Record<string, unknown>;
  evidence: EvidenceItem[];
  constraints: string[];
  candidate_actions: Array<{
    name: string;
    agent_type: string;
    action_type: string;
    payload: Record<string, unknown>;
    risk_level: ActionRiskLevel;
  }>;
  simulation_result?: SimulationResult;
  policy_evaluation: {
    allowed: boolean;
    requires_approval: boolean;
    risk_level: ActionRiskLevel;
    reason: string;
  };
  approval_id?: string;
  workflow_id?: string;
  status: "EVALUATING" | "PENDING_APPROVAL" | "EXECUTING" | "COMPLETED" | "REJECTED";
  created_at: string;
  updated_at: string;
}

// ============================================================
// 8. DECISION OUTCOME & FEEDBACK LOOP
// ============================================================

export interface DecisionOutcome {
  id: string;
  tenant_id: string;
  decision_id: string;
  recommendation_id?: string;
  workflow_id?: string;
  observed_at: string;
  evaluation_horizon_days: number;
  expected_metrics: Record<string, number>;
  actual_metrics: Record<string, number>;
  variance: Record<string, { expected: number; actual: number; delta_pct: number }>;
  outcome_evaluation: "EXCEEDED" | "MET" | "UNDERPERFORMED" | "INCONCLUSIVE";
  learning_notes: string;
  created_at: string;
}

// ============================================================
// 9. CUSTOMER RFM & COHORT CONTRACTS
// ============================================================

export type RFMSegment =
  | "CHAMPIONS"
  | "LOYAL_CUSTOMERS"
  | "POTENTIAL_LOYALISTS"
  | "RECENT_CUSTOMERS"
  | "PROMISING"
  | "NEED_ATTENTION"
  | "ABOUT_TO_SLEEP"
  | "AT_RISK"
  | "HIBERNATING"
  | "LOST";

export interface CustomerIntelligenceRecord {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  recency_days: number;
  frequency_orders: number;
  monetary_total_bdt: number;
  aov_bdt: number;
  r_score: number; // 1 to 5
  f_score: number; // 1 to 5
  m_score: number; // 1 to 5
  rfm_segment: RFMSegment;
  observed_ltv_bdt: number;
  estimated_ltv_bdt: number;
  churn_probability: number; // 0.0 to 1.0
  first_order_at: string;
  last_order_at: string;
  preferred_channel: string;
  created_at: string;
  updated_at: string;
}

export interface CohortPeriodData {
  period_index: number; // Month 0, 1, 2, ...
  active_customers: number;
  retention_rate_pct: number;
  revenue_bdt: number;
}

export interface CohortRecord {
  /** `coh_${tenant_id}_${cohort_month}`; rows written before FX-21 had no id or tenant and are ignored. */
  id: string;
  tenant_id: string;
  cohort_month: string; // e.g. "2026-01"
  initial_size: number;
  periods: CohortPeriodData[];
}

/** Collections holding computed intelligence snapshots, written only by an explicit recompute (FX-21). */
export type IntelligenceSnapshotCollection =
  | "customer_intelligence"
  | "product_performance"
  | "inventory_intelligence"
  | "anomalies"
  | "opportunities"
  | "risks"
  | "recommendations"
  | "cohort_records"
  | "data_quality_reports"
  | "growth_insights"
  | "growth_recommendations";

/** When a tenant's snapshot of one intelligence kind was last recomputed and stored (FX-21). */
export interface IntelligenceRun {
  id: string; // `irun_${tenant_id}_${kind}`
  tenant_id: string;
  kind: string;
  computed_at: string;
  row_count: number;
  /** Ids the recompute produced, in order: a snapshot read returns exactly these rows. */
  row_ids: string[];
}

// ============================================================
// 10. PRODUCT & INVENTORY INTELLIGENCE CONTRACTS
// ============================================================

export interface ProductPerformanceSnapshot {
  id: string;
  tenant_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  category_name?: string;
  units_sold_30d: number;
  revenue_bdt_30d: number;
  gross_margin_pct: number;
  return_rate_pct: number;
  cancellation_rate_pct: number;
  performance_score: number; // 0 to 100 transparent score
  score_breakdown: {
    sales_velocity_points: number;
    margin_points: number;
    retention_points: number;
    penalty_points: number;
  };
  status_tag: "BEST_SELLER" | "EMERGING" | "STEADY" | "SLOW_MOVING" | "DECLINING";
  computed_at: string;
}

export interface InventoryIntelligenceSnapshot {
  id: string;
  tenant_id: string;
  variant_id: string;
  product_name: string;
  sku: string;
  current_stock: number;
  reserved_stock: number;
  available_stock: number;
  average_daily_demand_30d: number;
  days_of_inventory_remaining: number;
  projected_stockout_date?: string;
  recommended_reorder_qty: number;
  safety_stock_units: number;
  stockout_risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  is_dead_stock: boolean;
  computed_at: string;
}

// ============================================================
// 11. DATA QUALITY & GOVERNANCE CONTRACTS
// ============================================================

export interface DataQualityCheck {
  name: string;
  description: string;
  passed: boolean;
  severity: "INFO" | "WARNING" | "CRITICAL";
  affected_count: number;
  details?: string;
}

export interface DataQualityReport {
  id: string;
  tenant_id: string;
  overall_score_pct: number;
  checks: DataQualityCheck[];
  missing_data_points: number;
  stale_data_points: number;
  orphan_records_count: number;
  generated_at: string;
}
