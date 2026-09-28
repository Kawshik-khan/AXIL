/**
 * CommerceOS Phase 7: Autonomous Growth, Marketing & Customer Lifecycle Engine
 * Comprehensive Domain Types, Enums, and Protocol Contracts
 */

import { ActionRiskLevel } from "./orchestration";
import { EvidenceItem } from "./intelligence";

// ============================================================
// 1. AUDIENCE & SEGMENTATION CONTRACTS
// ============================================================

export type AudienceType =
  | "STATIC"
  | "DYNAMIC"
  | "PREDICTIVE"
  | "BEHAVIORAL"
  | "LIFECYCLE";

export type AudienceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED" | "REFRESHING";

export type SegmentConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "CONTAINS"
  | "IN"
  | "NOT_IN"
  | "BETWEEN"
  | "BEFORE_DAYS_AGO"
  | "WITHIN_LAST_DAYS";

export interface SegmentCondition {
  field:
    | "total_spend"
    | "order_count"
    | "average_order_value"
    | "last_purchase_days_ago"
    | "first_purchase_days_ago"
    | "location"
    | "source"
    | "lifecycle_stage"
    | "rfm_segment"
    | "predicted_ltv_bdt"
    | "churn_risk_level"
    | "purchased_product_id"
    | "purchased_category"
    | "has_returned_order"
    | "has_failed_payment"
    | "has_abandoned_cart";
  operator: SegmentConditionOperator;
  value: unknown;
}

export interface AudienceRuleGroup {
  conjunction: "AND" | "OR";
  conditions: SegmentCondition[];
}

export interface PredictiveSegmentMetadata {
  model_name: string;
  model_version: string;
  score_threshold: number;
  data_window_days: number;
  generated_at: string;
}

export interface Audience {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  type: AudienceType;
  status: AudienceStatus;
  rule_groups: AudienceRuleGroup[];
  predictive_metadata?: PredictiveSegmentMetadata;
  estimated_size: number;
  last_evaluated_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AudienceMember {
  id: string;
  tenant_id: string;
  audience_id: string;
  customer_id: string;
  matched_at: string;
  match_reasons: string[];
}

export interface AudienceSnapshot {
  id: string;
  tenant_id: string;
  audience_id: string;
  campaign_id?: string;
  member_count: number;
  customer_ids: string[];
  snapshot_hash: string;
  created_at: string;
}

// ============================================================
// 2. CUSTOMER LIFECYCLE CONTRACTS
// ============================================================

export type LifecycleStage =
  | "PROSPECT"
  | "NEW"
  | "FIRST_PURCHASE"
  | "ACTIVE"
  | "REPEAT"
  | "LOYAL"
  | "AT_RISK"
  | "DORMANT"
  | "CHURNED"
  | "REACTIVATED";

export interface CustomerLifecycleRecord {
  id: string;
  tenant_id: string;
  customer_id: string;
  stage: LifecycleStage;
  previous_stage?: LifecycleStage;
  stage_entered_at: string;
  days_in_current_stage: number;
  order_count: number;
  total_revenue_bdt: number;
  average_order_value_bdt: number;
  last_order_at?: string;
  predicted_churn_risk: number; // 0 to 1
  predicted_ltv_12m_bdt: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerLifecycleTransition {
  id: string;
  tenant_id: string;
  customer_id: string;
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  trigger_event: string;
  reason: string;
  transitioned_at: string;
}

// ============================================================
// 3. CUSTOMER JOURNEY CONTRACTS
// ============================================================

export type JourneyStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

export type JourneyNodeType =
  | "TRIGGER"
  | "ELIGIBILITY"
  | "CONDITION"
  | "ACTION"
  | "WAIT"
  | "SPLIT"
  | "EXPERIMENT"
  | "EXIT";

export interface JourneyStep {
  id: string;
  type: JourneyNodeType;
  title: string;
  config: {
    trigger_event?: string;
    condition_predicate?: SegmentCondition;
    action_type?: "SEND_MESSAGE" | "APPLY_TAG" | "CREATE_DISCOUNT_OFFER" | "NOTIFY_AGENT";
    channel?: MarketingChannelType;
    template_id?: string;
    wait_duration_minutes?: number;
    split_branches?: Array<{ branch_id: string; condition: SegmentCondition; next_step_id: string }>;
    experiment_id?: string;
    exit_reason?: string;
  };
  next_step_id?: string;
}

export interface CustomerJourney {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  status: JourneyStatus;
  trigger_event: string;
  steps: JourneyStep[];
  enrolled_count: number;
  completed_count: number;
  created_at: string;
  updated_at: string;
}

export type JourneyEnrollmentStatus =
  | "ENROLLED"
  | "WAITING"
  | "READY"
  | "EXECUTING"
  | "COMPLETED"
  | "EXITED"
  | "PAUSED"
  | "FAILED";

export interface JourneyEnrollment {
  id: string;
  tenant_id: string;
  journey_id: string;
  customer_id: string;
  current_step_id: string;
  status: JourneyEnrollmentStatus;
  wait_until?: string;
  context_data: Record<string, unknown>;
  enrolled_at: string;
  last_action_at?: string;
  exit_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface JourneyExecutionRecord {
  id: string;
  tenant_id: string;
  journey_id: string;
  enrollment_id: string;
  step_id: string;
  node_type: JourneyNodeType;
  action_result: Record<string, unknown>;
  executed_at: string;
}

// ============================================================
// 4. CAMPAIGN MANAGEMENT CONTRACTS
// ============================================================

export type CampaignStatus =
  | "DRAFT"
  | "PLANNED"
  | "REVIEW"
  | "APPROVED"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type CampaignGoal =
  | "AWARENESS"
  | "ENGAGEMENT"
  | "CONVERSION"
  | "RETENTION"
  | "REACTIVATION"
  | "UPSELL"
  | "CROSS_SELL"
  | "CUSTOMER_SERVICE";

export interface CampaignVariant {
  id: string;
  name: string;
  subject_or_title: string;
  content_body: string;
  call_to_action: string;
  offer_id?: string;
  allocation_pct: number; // e.g. 50%
}

export interface GrowthCampaign {
  id: string;
  tenant_id: string;
  name: string;
  objective: CampaignGoal;
  status: CampaignStatus;
  audience_id: string;
  channel: MarketingChannelType;
  variants: CampaignVariant[];
  offer_id?: string;
  target_products?: string[];
  budget_bdt?: number;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  actual_started_at?: string;
  completed_at?: string;
  action_risk_level: ActionRiskLevel;
  required_approval: boolean;
  approval_request_id?: string;
  risk_class: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  simulation_snapshot?: CampaignSimulationSnapshot;
  result_metrics?: CampaignResult;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignSimulationSnapshot {
  simulated_at: string;
  estimated_reach: number;
  /** An assumption, listed in `assumptions`, not a measurement. */
  expected_conversion_rate: number;
  expected_orders: number;
  /** null when the tenant has no orders to take an average order value from. */
  expected_revenue_bdt: number | null;
  expected_cost_bdt: number;
  /** Not estimated (no margin model); kept for compatibility. */
  expected_margin_delta_pct: number | null;
  /** Every input that isn't the tenant's own data (FX-30). */
  assumptions: string[];
  simulated_label: "SIMULATED";
}

export interface CampaignResult {
  planned_audience: number;
  actual_audience: number;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  messages_suppressed: number;
  /** null until engagement is measured (no delivery/read receipts yet). */
  engagements: number | null;
  /** Orders attributed to this campaign so far; null until attribution has run. */
  conversions: number | null;
  attributed_revenue_bdt: number | null;
  /** Needs a control group; not measured (FX-30). */
  incremental_revenue_bdt: number | null;
  total_cost_bdt: number;
  roas: number | null;
  /** NOT_MEASURED at send time; outcomes come from recorded attributions, never from assumed rates. */
  attribution_status: "NOT_MEASURED" | "MEASURED";
  evaluated_at: string;
}

export interface CampaignExecutionRecord {
  id: string;
  tenant_id: string;
  campaign_id: string;
  total_recipients: number;
  processed_count: number;
  successful_count: number;
  failed_count: number;
  suppressed_count: number;
  status: "INITIALIZED" | "PROCESSING" | "COMPLETED" | "PAUSED" | "FAILED";
  started_at: string;
  completed_at?: string;
  last_batch_checkpoint?: string;
}

// ============================================================
// 5. CHANNELS, CONSENT & FREQUENCY CAPPING
// ============================================================

export type MarketingChannelType =
  | "WHATSAPP"
  | "FACEBOOK_MESSENGER"
  | "INSTAGRAM"
  | "WEBSITE_CHAT"
  | "EMAIL"
  | "TELEGRAM";

export interface ChannelDeliveryResult {
  success: boolean;
  external_message_id?: string;
  channel: MarketingChannelType;
  recipient_id: string;
  delivered_at?: string;
  error_message?: string;
  suppressed?: boolean;
  suppression_reason?: string;
}

export type ConsentStatus = "OPTED_IN" | "OPTED_OUT" | "PENDING";

export interface CustomerCommunicationPreference {
  id: string;
  tenant_id: string;
  customer_id: string;
  channel: MarketingChannelType;
  purpose: "MARKETING" | "TRANSACTIONAL" | "SERVICE";
  status: ConsentStatus;
  consent_source: string;
  opted_in_at?: string;
  opted_out_at?: string;
  updated_at: string;
}

export interface SuppressionEntry {
  id: string;
  tenant_id: string;
  customer_id: string;
  channel?: MarketingChannelType;
  reason: "CUSTOMER_OPT_OUT" | "FREQUENCY_CAPPED" | "BOUNCED" | "SPAM_COMPLAINT" | "OPERATOR_OVERRIDE";
  suppressed_until?: string;
  created_at: string;
}

export interface FrequencyCapPolicy {
  max_messages_per_day: number;
  max_messages_per_week: number;
  cooldown_period_hours: number;
}

// ============================================================
// 6. CONTENT ENGINE & GROUNDED PERSONALIZATION
// ============================================================

export interface ContentTemplate {
  id: string;
  tenant_id: string;
  name: string;
  channel: MarketingChannelType;
  language: "bn" | "banglish" | "en";
  category: "PROMOTIONAL" | "CART_RECOVERY" | "WIN_BACK" | "CROSS_SELL" | "LOYALTY";
  body_template: string; // supports {{customer_name}}, {{product_name}}, {{price}}, {{discount_code}}
  variables_schema: string[];
  created_at: string;
}

export interface ContentAsset {
  id: string;
  tenant_id: string;
  template_id?: string;
  channel: MarketingChannelType;
  language: "bn" | "banglish" | "en";
  rendered_text: string;
  verified_product_id?: string;
  verified_price?: number;
  verified_stock_status?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  verification_passed: boolean;
  created_at: string;
}

export interface GroundedContentVerification {
  is_valid: boolean;
  prohibited_claims_found: string[];
  price_verified: boolean;
  stock_verified: boolean;
  violations: string[];
}

// ============================================================
// 7. OFFER ENGINE & PROMOTION INTELLIGENCE
// ============================================================

export type OfferType =
  | "PERCENTAGE"
  | "FIXED_AMOUNT"
  | "FREE_SHIPPING"
  | "BUNDLE"
  | "BUY_X_GET_Y";

export interface OfferRule {
  min_cart_value_bdt?: number;
  max_discount_bdt?: number;
  allowed_category_ids?: string[];
  allowed_product_ids?: string[];
  customer_segment?: string;
  max_usages_per_customer?: number;
  total_usage_limit?: number;
}

export interface GrowthOffer {
  id: string;
  tenant_id: string;
  code: string;
  title: string;
  description: string;
  type: OfferType;
  value: number; // e.g. 15 for 15%, 150 for 150 BDT
  rules: OfferRule;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
  current_usage_count: number;
  created_at: string;
}

export interface OfferUsage {
  id: string;
  tenant_id: string;
  offer_id: string;
  customer_id: string;
  order_id: string;
  discount_amount_bdt: number;
  used_at: string;
}

export interface OfferSimulationResult {
  offer_id: string;
  /** Not measured: no redemption history (FX-30: was a fixed 22.5%). */
  estimated_redemption_rate_pct: number | null;
  estimated_order_volume: number;
  projected_gross_revenue_bdt: number;
  projected_discount_cost_bdt: number;
  projected_net_margin_bdt: number;
  margin_safe: boolean; // false if margin drops below safe baseline
  risk_warning?: string;
  /** Inputs that aren't the tenant's own data. */
  assumptions: string[];
}

// ============================================================
// 8. PRODUCT RECOMMENDATIONS, CROSS-SELL & RECOVERY
// ============================================================

export interface RecommendationCandidate {
  product_id: string;
  product_name: string;
  price_bdt: number;
  available_stock: number;
  affinity_score: number; // 0 to 1
  reasoning: string; // e.g. "Customers who purchased Classic Oxford Shirt also bought Leather Belt"
  type: "CROSS_SELL" | "UPSELL" | "FREQUENTLY_BOUGHT_TOGETHER" | "WIN_BACK_REPLENISHMENT";
}

export interface ProductAffinity {
  primary_product_id: string;
  secondary_product_id: string;
  affinity_strength: number; // co-purchase frequency
  confidence_pct: number;
}

export interface AbandonedCartRecoveryItem {
  id: string;
  tenant_id: string;
  customer_id: string;
  order_draft_id?: string;
  cart_items: Array<{ product_id: string; title: string; price: number; quantity: number }>;
  abandoned_total_bdt: number;
  abandoned_at: string;
  recovery_stage: "PENDING" | "MESSAGED" | "RECOVERED" | "EXPIRED";
  recovered_order_id?: string;
}

// ============================================================
// 9. EXPERIMENTATION & A/B TESTING
// ============================================================

export type ExperimentStatus =
  | "DRAFT"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export interface GrowthExperiment {
  id: string;
  tenant_id: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  primary_metric: "CONVERSION_RATE" | "AVERAGE_ORDER_VALUE" | "REVENUE_PER_RECIPIENT" | "ENGAGEMENT_RATE";
  audience_id: string;
  variants: Array<{
    variant_id: string;
    name: string;
    description: string;
    traffic_allocation_pct: number;
  }>;
  min_sample_size: number;
  min_runtime_days: number;
  started_at?: string;
  concluded_at?: string;
  winning_variant_id?: string;
  created_at: string;
}

export interface ExperimentAssignment {
  id: string;
  tenant_id: string;
  experiment_id: string;
  customer_id: string;
  assigned_variant_id: string;
  assigned_at: string;
  has_converted: boolean;
  conversion_value_bdt?: number;
}

export interface ExperimentResult {
  experiment_id: string;
  total_participants: number;
  variant_metrics: Record<
    string,
    {
      participants: number;
      conversions: number;
      conversion_rate_pct: number;
      revenue_bdt: number;
      aov_bdt: number;
      p_value: number;
      is_significant: boolean;
    }
  >;
  status: "INCONCLUSIVE" | "WINNER_DETERMINED" | "INSUFFICIENT_DATA";
  winner_variant_id?: string;
  evaluated_at: string;
}

// ============================================================
// 10. CAMPAIGN & REVENUE ATTRIBUTION
// ============================================================

export type AttributionModel =
  | "LAST_TOUCH"
  | "FIRST_TOUCH"
  | "LINEAR"
  | "TIME_DECAY";

export interface AttributionTouch {
  touch_id: string;
  campaign_id: string;
  channel: MarketingChannelType;
  touched_at: string;
  weight: number;
}

export interface CampaignAttribution {
  id: string;
  tenant_id: string;
  order_id: string;
  customer_id: string;
  order_total_bdt: number;
  attribution_model: AttributionModel;
  touchpoints: AttributionTouch[];
  campaign_credits: Record<string, { attributed_revenue_bdt: number; share_pct: number }>;
  /** Needs a control group to measure; null (FX-30). Older rows may hold an assumed 70% figure. */
  incremental_revenue_estimated_bdt: number | null;
  created_at: string;
}

// ============================================================
// 11. GROWTH INTELLIGENCE & RECOMMENDATIONS
// ============================================================

export interface GrowthInsight {
  id: string;
  tenant_id: string;
  type:
    | "REPEAT_PURCHASE_DROP"
    | "HIGH_VALUE_DORMANCY"
    | "CROSS_SELL_OPPORTUNITY"
    | "CAMPAIGN_FATIGUE"
    | "LOW_MARGIN_DISCOUNTING"
    | "CART_ABANDONMENT_SPIKE";
  title: string;
  summary: string;
  evidence: EvidenceItem[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detected_at: string;
}

export interface GrowthOpportunity {
  id: string;
  tenant_id: string;
  title: string;
  target_segment: string;
  suggested_action: string;
  potential_revenue_bdt: number;
  confidence: number;
  evidence: EvidenceItem[];
}

export interface GrowthRecommendation {
  id: string;
  tenant_id: string;
  title: string;
  strategy: string;
  target_audience_name: string;
  recommended_channel: MarketingChannelType;
  rationale: string;
  evidence: EvidenceItem[];
  expected_impact: {
    /** null when there's no history to project from (FX-30: were fixed ৳45,000 / ৳28,000). */
    projected_revenue_bdt: number | null;
    projected_roi_multiplier: number | null;
    summary: string;
  };
  action_risk_level: ActionRiskLevel;
  required_autonomy_level: number;
  assumptions: string[];
  expires_at: string;
  status: "PROPOSED" | "APPROVED" | "EXECUTED" | "DISMISSED";
  created_at: string;
}
