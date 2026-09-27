/**
 * CommerceOS Phase 9: Enterprise Commerce Intelligence & Ecosystem Types
 * Multi-entity hierarchy, enterprise RBAC, semantic metrics layer, benchmarking,
 * integration framework, developer platform, webhooks, data governance, and MDM.
 */

// ============================================================
// 1. ENTERPRISE HIERARCHY & ENTITY MANAGEMENT
// ============================================================

export type EntityType =
  | "ORGANIZATION"
  | "BUSINESS_UNIT"
  | "BRAND_GROUP"
  | "BRAND"
  | "STORE"
  | "SALES_CHANNEL"
  | "WAREHOUSE";

export interface Organization {
  id: string;
  /** Owning workspace. Only that workspace can use the organization (FX-13); legacy rows without one are unusable. */
  tenant_id?: string;
  name: string;
  slug: string;
  legal_name: string;
  tax_identifier?: string;
  default_currency: string;
  supported_currencies: string[];
  headquarters_country: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  created_at: string;
  updated_at: string;
}

export interface BusinessUnit {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  description?: string;
  leader_user_id?: string;
  budget_allocated_bdt: number;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
}

export interface BrandGroup {
  id: string;
  organization_id: string;
  business_unit_id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface EnterpriseBrand {
  id: string;
  organization_id: string;
  business_unit_id: string;
  brand_group_id?: string;
  name: string;
  slug: string;
  logo_url?: string;
  primary_category: string;
  target_audience?: string;
  currency: string;
  shared_resources: {
    warehouses: boolean;
    payment_gateways: boolean;
    couriers: boolean;
  };
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
}

export interface EnterpriseStore {
  id: string;
  organization_id: string;
  business_unit_id: string;
  brand_id: string;
  name: string;
  code: string;
  store_type: "ONLINE_STORE" | "PHYSICAL_OUTLET" | "POPUP" | "MARKETPLACE_OUTLET";
  region: string;
  city: string;
  currency: string;
  assigned_warehouse_ids: string[];
  assigned_payment_provider_ids: string[];
  assigned_courier_ids: string[];
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  created_at: string;
  updated_at: string;
}

export interface SalesChannel {
  id: string;
  organization_id: string;
  store_id: string;
  name: string;
  channel_type: "WEBSITE" | "FACEBOOK" | "INSTAGRAM" | "WHATSAPP" | "DARAZ" | "AMAZON" | "CUSTOM";
  is_active: boolean;
  created_at: string;
}

export interface Region {
  id: string;
  organization_id: string;
  name: string;
  country: string;
  code: string;
  currency: string;
  time_zone: string;
}

export interface EntityMembership {
  id: string;
  organization_id: string;
  user_id: string;
  entity_type: EntityType;
  entity_id: string;
  role: string;
  granted_by: string;
  created_at: string;
}

// ============================================================
// 2. ENTERPRISE RBAC & ROLES
// ============================================================

export type EnterpriseRoleName =
  | "ORGANIZATION_OWNER"
  | "ENTERPRISE_ADMIN"
  | "BUSINESS_UNIT_ADMIN"
  | "BRAND_MANAGER"
  | "STORE_MANAGER"
  | "FINANCE_MANAGER"
  | "OPERATIONS_MANAGER"
  | "MARKETING_MANAGER"
  | "ANALYST"
  | "SUPPORT_MANAGER"
  | "INTEGRATION_MANAGER"
  | "DEVELOPER"
  | "AUDITOR"
  | "READ_ONLY";

export interface EnterpriseScope {
  organization_id: string;
  business_unit_ids?: string[];
  brand_ids?: string[];
  store_ids?: string[];
  warehouse_ids?: string[];
  all_access: boolean;
}

export interface EnterpriseUserRecord {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  email: string;
  enterprise_role: EnterpriseRoleName;
  assigned_scope: EnterpriseScope;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  created_at: string;
  updated_at: string;
}

// ============================================================
// 3. SEMANTIC METRICS LAYER & GOVERNED KPI FRAMEWORK
// ============================================================

export type MetricCategory =
  | "FINANCIAL"
  | "COMMERCE"
  | "INVENTORY"
  | "FULFILLMENT"
  | "CUSTOMER"
  | "MARKETING"
  | "OPERATIONAL";

export type MetricTimeGrain = "HOUR" | "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export interface MetricDimension {
  id: string;
  name: string;
  key: string;
  dimension_type: "ENTITY" | "GEOGRAPHY" | "CHANNEL" | "PRODUCT" | "TIME";
  allowed_values?: string[];
}

export interface MetricDefinition {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  category: MetricCategory;
  description: string;
  formula: string;
  unit: "BDT" | "PERCENT" | "COUNT" | "DAYS" | "HOURS" | "RATIO";
  supported_dimensions: string[];
  supported_time_grains: MetricTimeGrain[];
  data_quality_status: "VERIFIED" | "ESTIMATED" | "DEGRADED";
  owner: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface SemanticMetricQuery {
  metric_key: string;
  entity_type?: EntityType;
  entity_id?: string;
  time_grain?: MetricTimeGrain;
  start_date?: string;
  end_date?: string;
  currency?: string;
  dimensions?: Record<string, string>;
}

export interface SemanticMetricResult {
  metric_key: string;
  metric_name: string;
  value: number;
  unit: string;
  currency?: string;
  time_grain: MetricTimeGrain;
  dimensions_applied: Record<string, string>;
  data_quality_status: "VERIFIED" | "ESTIMATED" | "DEGRADED";
  formula_used: string;
  calculated_at: string;
  sample_count: number;
}

// ============================================================
// 4. ENTERPRISE BENCHMARKING & REPORTING
// ============================================================

export type BenchmarkType =
  | "STORE_VS_STORE"
  | "BRAND_VS_BRAND"
  | "UNIT_VS_UNIT"
  | "REGION_VS_REGION"
  | "CHANNEL_VS_CHANNEL"
  | "HISTORICAL_COMPARISON"
  | "INDUSTRY_EXTERNAL";

export interface BenchmarkComparisonItem {
  entity_id: string;
  entity_name: string;
  entity_type: EntityType;
  metric_key: string;
  value: number;
  rank: number;
  percentile: number;
  variance_from_average_pct: number;
}

export interface EnterpriseBenchmark {
  id: string;
  organization_id: string;
  title: string;
  benchmark_type: BenchmarkType;
  metric_key: string;
  population_count: number;
  time_period: string;
  items: BenchmarkComparisonItem[];
  cohort_average: number;
  cohort_median: number;
  limitations_disclosure: string;
  is_statistically_significant: boolean;
  generated_at: string;
}

export interface ReportDefinition {
  id: string;
  organization_id: string;
  title: string;
  category: "EXECUTIVE" | "SALES" | "FINANCE" | "INVENTORY" | "OPERATIONS" | "MARKETING";
  metrics: string[];
  dimensions: string[];
  entity_scope: EnterpriseScope;
  format: "JSON" | "CSV" | "PDF" | "SPREADSHEET";
  schedule?: "DAILY" | "WEEKLY" | "MONTHLY";
  recipient_emails: string[];
  created_at: string;
}

export interface ReportExecution {
  id: string;
  report_definition_id: string;
  organization_id: string;
  generated_at: string;
  status: "COMPLETED" | "FAILED";
  records_count: number;
  download_url?: string;
  summary_metrics: Record<string, number | string>;
}

// ============================================================
// 5. INTEGRATION HUB & ADAPTER FRAMEWORK
// ============================================================

export type IntegrationCategory = "ERP" | "CRM" | "ACCOUNTING" | "MARKETPLACE" | "PAYMENT" | "LOGISTICS";

export type IntegrationStatus =
  | "CONNECTED"
  | "SYNCING"
  | "HEALTHY"
  | "DEGRADED"
  | "FAILED"
  | "DISCONNECTED"
  | "REQUIRES_AUTH"
  | "RATE_LIMITED";

export interface IntegrationProvider {
  id: string;
  name: string;
  category: IntegrationCategory;
  supported_entities: string[];
  auth_type: "OAUTH2" | "API_KEY" | "BASIC" | "BEARER";
  icon_url?: string;
  description: string;
}

export interface IntegrationInstallation {
  id: string;
  organization_id: string;
  provider_id: string;
  provider_name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  credentials_encrypted: string;
  config: Record<string, unknown>;
  sync_frequency_minutes: number;
  last_sync_at?: string;
  last_successful_sync_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface MappingField {
  source_field: string;
  target_field: string;
  data_type: "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "OBJECT";
  transformation?: "TRIM" | "UPPERCASE" | "LOWERCASE" | "PARSE_NUMBER" | "DATE_ISO";
  default_value?: unknown;
  is_required: boolean;
}

export interface IntegrationMapping {
  id: string;
  organization_id: string;
  integration_id: string;
  entity_type: string;
  fields: MappingField[];
  version: string;
  created_at: string;
  updated_at: string;
}

export type ConflictStrategy =
  | "COMMERCEOS_WINS"
  | "EXTERNAL_WINS"
  | "LATEST_VALID_UPDATE"
  | "MANUAL_REVIEW"
  | "FIELD_OWNERSHIP";

export interface IntegrationConflict {
  id: string;
  organization_id: string;
  integration_id: string;
  entity_type: string;
  entity_id: string;
  commerceos_value: Record<string, unknown>;
  external_value: Record<string, unknown>;
  conflict_field: string;
  resolution_strategy: ConflictStrategy;
  resolved: boolean;
  resolution_decision?: "COMMERCEOS_ACCEPTED" | "EXTERNAL_ACCEPTED" | "MANUAL_MERGED";
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface IntegrationSyncRecord {
  id: string;
  organization_id: string;
  integration_id: string;
  entity_type: string;
  sync_type: "FULL" | "INCREMENTAL" | "EVENT_DRIVEN";
  direction: "INBOUND" | "OUTBOUND" | "BI_DIRECTIONAL";
  status: "STARTED" | "COMPLETED" | "FAILED" | "PARTIALLY_FAILED";
  records_processed: number;
  records_succeeded: number;
  records_failed: number;
  conflicts_detected: number;
  duration_ms: number;
  error_summary?: string;
  started_at: string;
  completed_at?: string;
}

// ============================================================
// 6. DEVELOPER PLATFORM & WEBHOOK INFRASTRUCTURE
// ============================================================

export interface DeveloperApplication {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  client_id: string;
  client_secret_hash: string;
  allowed_scopes: string[];
  redirect_uris: string[];
  rate_limit_per_minute: number;
  status: "ACTIVE" | "REVOKED";
  created_at: string;
}

export interface APIKeyRecord {
  id: string;
  organization_id: string;
  application_id?: string;
  name: string;
  key_prefix: string; // e.g. "pk_live_ab12..."
  key_hash: string;
  scopes: string[];
  allowed_ip_ranges?: string[];
  last_used_at?: string;
  expires_at?: string;
  status: "ACTIVE" | "REVOKED";
  created_at: string;
}

export interface EnterpriseWebhookSubscription {
  id: string;
  organization_id: string;
  application_id?: string;
  target_url: string;
  secret: string; // HMAC secret
  event_types: string[]; // e.g. ["order.created", "inventory.low_stock", "incident.created"]
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  retry_count_max: number;
  failed_consecutive_deliveries: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  target_url: string;
  payload_json: string;
  signature: string;
  http_status?: number;
  duration_ms: number;
  attempt_number: number;
  status: "DELIVERED" | "FAILED" | "RETRY_SCHEDULED" | "DEAD_LETTERED";
  response_body?: string;
  delivered_at: string;
}

// ============================================================
// 7. DATA GOVERNANCE, LINEAGE & QUALITY
// ============================================================

export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export interface DataAsset {
  id: string;
  organization_id: string;
  name: string;
  domain: string;
  classification: DataClassification;
  pii_contained: boolean;
  pii_fields: string[];
  retention_days: number;
  owner_team: string;
  created_at: string;
}

export interface DataLineageTrace {
  id: string;
  organization_id: string;
  target_asset_name: string;
  target_field: string;
  source_system: string;
  source_endpoint_or_table: string;
  transformations_applied: string[];
  intermediate_aggregations: string[];
  verified_timestamp: string;
}

export interface DataQualityRule {
  id: string;
  organization_id: string;
  entity_type: string;
  field_name: string;
  rule_type: "NOT_NULL" | "UNIQUE" | "RANGE" | "REGEX" | "REFERENTIAL_INTEGRITY" | "CURRENCY_MATCH";
  parameters: Record<string, unknown>;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  is_active: boolean;
}

export interface DataQualityIssue {
  id: string;
  organization_id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  detected_value?: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "IGNORED";
  resolution_notes?: string;
  created_at: string;
  resolved_at?: string;
}

// ============================================================
// 8. MASTER DATA MANAGEMENT & CUSTOMER IDENTITY
// ============================================================

export interface EnterpriseCustomerIdentity {
  id: string;
  organization_id: string;
  canonical_name: string;
  primary_phone: string;
  primary_email?: string;
  store_affiliations: string[]; // Store IDs
  external_identities: Array<{
    system_type: "SHOPIFY" | "DARAZ" | "CRM" | "ERP" | "FACEBOOK";
    external_id: string;
    linked_at: string;
  }>;
  total_lifetime_orders: number;
  total_spend_bdt: number;
  confidence_score: number; // 0 to 1
  requires_manual_merge_review: boolean;
  status: "VERIFIED" | "PENDING_REVIEW" | "MERGED";
  created_at: string;
  updated_at: string;
}

// ============================================================
// 9. ENTERPRISE OPERATIONS & INCIDENTS
// ============================================================

export type IncidentSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type IncidentStatus =
  | "DETECTED"
  | "TRIAGED"
  | "INVESTIGATING"
  | "MITIGATING"
  | "RESOLVED"
  | "POSTMORTEM";

export interface EnterpriseIncident {
  id: string;
  organization_id: string;
  title: string;
  domain: "INTEGRATION" | "PAYMENT" | "LOGISTICS" | "INVENTORY" | "DATA_PIPELINE" | "SECURITY" | "API";
  severity: IncidentSeverity;
  status: IncidentStatus;
  impacted_entities: {
    stores?: string[];
    brands?: string[];
    integrations?: string[];
  };
  root_cause?: string;
  mitigation_plan?: string;
  assigned_to_user_id?: string;
  detected_at: string;
  mitigated_at?: string;
  resolved_at?: string;
  postmortem_notes?: string;
}

// ============================================================
// 10. ENTERPRISE AI GOVERNANCE & COST LIMITS
// ============================================================

export interface EnterpriseAIBudget {
  id: string;
  organization_id: string;
  entity_type: EntityType;
  entity_id: string;
  monthly_budget_usd: number;
  monthly_spent_usd: number;
  max_tokens_per_month: number;
  tokens_consumed_month: number;
  allowed_models: string[];
  blocked_tools: string[];
  approval_required_for_tier2: boolean;
  status: "ACTIVE" | "EXCEEDED" | "RESTRICTED";
  updated_at: string;
}

export interface AIUsageRecord {
  id: string;
  organization_id: string;
  store_id?: string;
  agent_type: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  workflow_id?: string;
  timestamp: string;
}

// ============================================================
// 11. ENTERPRISE OVERVIEW & COMMAND CENTER
// ============================================================

export interface EnterpriseOverview {
  organization: Organization;
  summary_metrics: {
    total_business_units: number;
    total_brands: number;
    total_stores: number;
    active_channels: number;
    consolidated_revenue_bdt: number;
    consolidated_orders: number;
    blended_gross_margin_pct: number;
    network_stockout_risk_items: number;
    active_incidents_count: number;
    data_quality_health_pct: number;
    connected_integrations_count: number;
    ai_budget_used_pct: number;
  };
  entity_health_matrix: Array<{
    entity_id: string;
    entity_name: string;
    entity_type: EntityType;
    status: "HEALTHY" | "DEGRADED" | "CRITICAL";
    revenue_bdt: number;
    order_count: number;
    stockout_count: number;
    fulfillment_sla_pct: number;
  }>;
  recent_incidents: EnterpriseIncident[];
  recent_syncs: IntegrationSyncRecord[];
}

// ============================================================
// 12. PARTNER ECOSYSTEM & APP MARKETPLACE
// ============================================================

export interface Partner {
  id: string;
  name: string;
  email: string;
  website?: string;
  is_verified: boolean;
  created_at: string;
}

export interface PartnerApplication {
  id: string;
  partner_id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  required_scopes: string[];
  is_verified: boolean;
  pricing_tier: "FREE" | "STANDARD" | "USAGE_BASED" | "ENTERPRISE";
  created_at: string;
}

export interface PartnerInstallation {
  id: string;
  tenant_id: string;
  app_id: string;
  installed_at: string;
  status: "ACTIVE" | "SUSPENDED" | "UNINSTALLED";
  configuration?: Record<string, unknown>;
}

export type {
  ConsolidatedEnterpriseAnalytics,
  EntityAnalyticsSummary,
} from "@/domains/enterprise/services/enterprise-analytics.service";


