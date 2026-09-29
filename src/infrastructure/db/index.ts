import { randomSuffix } from "@/lib/ids";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "@/lib/logger";
import { envNumber } from "@/lib/env-number";
import { AppError } from "@/lib/errors";
import { mergeComputedRow } from "@/lib/computed-rows";
import { channelOfOrder, SALES_CHANNEL_NAMES } from "@/lib/sales-channel";
import type { SalesChannel as OrderSalesChannel } from "@/types/analytics";
import bcrypt from "bcryptjs";
import { RoleName } from "@/lib/permissions";
import { DISABLED_PASSWORD_HASH } from "@/lib/security";
import { LEASE_TTL_MS, LeaseLostError, PgStorePersistence, type RejectedRow } from "@/infrastructure/store/pg-store";
import { createNeonSqlClient, storeConnectionString, type SqlClient } from "@/infrastructure/store/sql-client";
import { ConnectorConfigRecord } from "@/types/connector";
import {
  Product,
  ProductVariant,
  Category,
  Brand,
  Warehouse,
  InventoryItem,
  StockMovement,
  InventoryReservation,
  Customer,
  CustomerAddress,
  Order,
  OrderItem,
  Payment,
  Shipment,
  Return,
  Refund,
  Coupon,
  CommerceEvent,
  WebhookSubscription,
  StockMovementType,
  OrderStatus,
  PaymentStatus,
  FulfillmentStatus,
  DeliveryStatus,
} from "@/types/commerce";
import {
  PlatformMembershipRecord,
  PlatformPermissionRecord,
  PlatformRolePermissionRecord,
  ImpersonationSessionRecord,
  PlanRecord,
  PlanVersionRecord,
  SubscriptionRecord,
  EntitlementRecord,
  TenantEntitlementRecord,
  UsageRecordRecord,
  PlatformFeatureFlagRecord,
  PlatformSettingRecord,
  PlatformSettingVersionRecord,
  PlatformIncidentRecord,
  PlatformMaintenanceWindowRecord,
  PlatformAuditLogRecord,
  PlatformKillSwitchRecord,
  PlatformSecurityEventRecord,
  PlatformAnnouncementRecord,
  PlatformApiKeyRecord,
} from "@/types/platform";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  legal_name?: string;
  currency: string;
  timezone: string;
  language: string;
  country?: string;
  settings: Record<string, unknown>;
  status: "ACTIVE" | "SUSPENDED" | "PROVISIONING" | "TRIAL" | "PAST_DUE" | "CANCELLED" | "ARCHIVED";
  plan_id?: string;
  billing_status?: string;
  suspended_at?: string;
  suspension_reason?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  password_hash: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
  /** Bumped to revoke every existing session of this user (FX-15). Missing means 1. */
  session_version?: number;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

/** Machine credential for automation callers such as n8n (FX-18). Only a SHA-256 hash of the token is stored. */
export interface ServiceTokenRecord {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  created_by: string;
  created_at: string;
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
}

export interface MembershipRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  role: RoleName;
  /** Access to THIS workspace only; the account itself (users.status) is platform-level (STATUS N5). */
  status?: "ACTIVE" | "SUSPENDED";
  created_at: string;
  updated_at: string;
}

export interface InvitationRecord {
  id: string;
  tenant_id: string;
  email: string;
  role: RoleName;
  token: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  expires_at: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

import {
  ConnectedChannel,
  CustomerIdentity,
  Conversation,
  Message,
  ConversationAssignment,
  ConversationTag,
  Lead,
  Attachment,
  QuickReply,
  BusinessHours,
  ChatSession,
  OutboundWebhookDelivery,
  ChannelType,
} from "@/types/social";
import {
  AgentType,
  AgentDefinition,
  TenantAIPolicy,
  AgentRun,
  AgentToolCallRecord,
  AgentPrompt,
  PromptVersion,
  ConversationSummary,
  CustomerMemory,
  KnowledgeDocument,
  KnowledgeChunk,
  AITrace,
  AIUsageRecord,
  AIFeedbackRecord,
} from "@/types/ai";
import {
  AgentWorkflow,
  AgentTask,
  AgentMessage,
  WorkflowContext,
  WorkflowArtifact,
  WorkflowCheckpoint,
  AgentDelegation,
  AgentVerification,
  ApprovalRequest,
  AutonomyPolicy,
  WorkflowTemplate,
  AgentTriggerRule,
  ActionReceipt,
  AgentSchedule,
} from "@/types/orchestration";
import {
  MetricDefinition,
  MetricSnapshot,
  Insight,
  Anomaly,
  Opportunity,
  Risk,
  Recommendation,
  ForecastRun,
  SimulationResult,
  DecisionRequest,
  DecisionOutcome,
  CustomerIntelligenceRecord,
  ProductPerformanceSnapshot,
  InventoryIntelligenceSnapshot,
  CohortRecord,
  ModelRegistryEntry,
  DataQualityReport,
  IntelligenceRun,
  IntelligenceSnapshotCollection,
} from "@/types/intelligence";
import {
  Audience,
  AudienceMember,
  AudienceSnapshot,
  CustomerLifecycleRecord,
  CustomerLifecycleTransition,
  CustomerJourney,
  JourneyEnrollment,
  JourneyExecutionRecord,
  GrowthCampaign,
  CampaignExecutionRecord,
  ContentAsset,
  ContentTemplate,
  GrowthOffer,
  OfferUsage,
  GrowthExperiment,
  ExperimentAssignment,
  CustomerCommunicationPreference,
  SuppressionEntry,
  CampaignAttribution,
  GrowthInsight,
  GrowthRecommendation,
  AbandonedCartRecoveryItem,
} from "@/types/growth";
import { ExecutiveDigest } from "@/types/analytics";
import {
  Supplier,
  SupplierProduct,
  PurchaseOrder,
  PurchaseOrderItem,
  ProcurementRecommendation,
  SupplierPerformance,
  PricingRule,
  PricingRecommendation,
  PriceChangeRequest,
  PriceChangeExecution,
  ShipmentException,
  CourierPerformance,
  FulfillmentPlan,
  PaymentOperation,
  PaymentException,
  ReconciliationRun,
  ReconciliationItem,
  FinancialException,
  SettlementRecord,
  SupportTicket,
  OperationalException,
  ExceptionPolicy,
  ProviderHealth,
  ProviderIncident,
  SLAPolicy,
  SLABreach,
  AutonomyBudget,
  BulkOperationSafeguard,
} from "@/types/operations";
import {
  Organization,
  BusinessUnit,
  BrandGroup,
  EnterpriseBrand,
  EnterpriseStore,
  SalesChannel,
  Region,
  EntityMembership,
  EnterpriseUserRecord,
  MetricDefinition as EnterpriseMetricDefinition,
  EnterpriseBenchmark,
  ReportDefinition,
  ReportExecution,
  IntegrationProvider,
  IntegrationInstallation,
  IntegrationMapping,
  IntegrationConflict,
  IntegrationSyncRecord,
  DeveloperApplication,
  APIKeyRecord,
  EnterpriseWebhookSubscription,
  WebhookDeliveryRecord,
  DataAsset,
  DataLineageTrace,
  DataQualityRule,
  DataQualityIssue,
  EnterpriseCustomerIdentity,
  EnterpriseIncident,
  EnterpriseAIBudget,
  AIUsageRecord as EnterpriseAIUsageRecord,
} from "@/types/enterprise";
import {
  BusinessObjective,
  ObjectiveRun,
  ObjectiveOutcome,
  GlobalDecision,
  Strategy,
  CrossDomainAgentMessage,
  AgentProposal,
  AgentConflict,
  LearningCandidate,
  AIModel,
  ModelDeployment,
  AIProvider,
  AutonomyRecommendation,
  PlatformHealth,
  DomainHealthRecord,
  SLODefinition,
  ErrorBudget,
  DataResidencyPolicy,
  GlobalEventEnvelope,
  Extension,
  Plugin,
  PlatformCostRecord,
  AutonomousQualityScorecard,
  AutonomousWorkflowRun,
  ChaosTestScenario,
  LoadTestScenario,
  RollbackAction,
} from "@/types/autonomous";
import {
  AutomationRecord,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  N8nInstance,
  AutomationTrigger,
  AutomationExecution,
  AutomationExecutionStep,
  IdempotencyRecord,
  AutomationRetry,
  AutomationDeadLetter,
  AutomationWebhook,
  AutomationWebhookDelivery,
  AutomationAuditRecord,
} from "@/types/automation";

export interface DatabaseSchema {
  tenants: TenantRecord[];
  users: UserRecord[];
  memberships: MembershipRecord[];
  invitations: InvitationRecord[];
  audit_logs: AuditLogRecord[];
  products: Product[];
  product_variants: ProductVariant[];
  categories: Category[];
  brands: Brand[];
  warehouses: Warehouse[];
  inventory_items: InventoryItem[];
  stock_movements: StockMovement[];
  inventory_reservations: InventoryReservation[];
  /** Last order number issued per tenant (FX-35). */
  order_sequences: Record<string, number>;
  customers: Customer[];
  customer_addresses: CustomerAddress[];
  orders: Order[];
  order_items: OrderItem[];
  payments: Payment[];
  shipments: Shipment[];
  returns: Return[];
  refunds: Refund[];
  coupons: Coupon[];
  events: CommerceEvent[];
  webhooks: WebhookSubscription[];
  connected_channels: ConnectedChannel[];
  customer_identities: CustomerIdentity[];
  conversations: Conversation[];
  messages: Message[];
  conversation_assignments: ConversationAssignment[];
  conversation_tags: ConversationTag[];
  leads: Lead[];
  attachments: Attachment[];
  quick_replies: QuickReply[];
  business_hours: BusinessHours[];
  chat_sessions: ChatSession[];
  outbound_webhook_deliveries: OutboundWebhookDelivery[];
  // Phase 4: AI & Agentic Commerce Collections
  agents: AgentDefinition[];
  agent_policies: TenantAIPolicy[];
  agent_runs: AgentRun[];
  agent_tool_calls: AgentToolCallRecord[];
  agent_prompts: AgentPrompt[];
  prompt_versions: PromptVersion[];
  conversation_summaries: ConversationSummary[];
  customer_memories: CustomerMemory[];
  knowledge_documents: KnowledgeDocument[];
  knowledge_chunks: KnowledgeChunk[];
  ai_traces: AITrace[];
  ai_usage: AIUsageRecord[];
  ai_feedback: AIFeedbackRecord[];
  // Phase 5: Multi-Agent Orchestration & Controlled Autonomy Collections
  workflows: AgentWorkflow[];
  tasks: AgentTask[];
  agent_messages: AgentMessage[];
  workflow_contexts: WorkflowContext[];
  workflow_artifacts: WorkflowArtifact[];
  workflow_checkpoints: WorkflowCheckpoint[];
  agent_delegations: AgentDelegation[];
  agent_verifications: AgentVerification[];
  approval_requests: ApprovalRequest[];
  autonomy_policies: AutonomyPolicy[];
  workflow_templates: WorkflowTemplate[];
  trigger_rules: AgentTriggerRule[];
  action_receipts: ActionReceipt[];
  agent_schedules: AgentSchedule[];
  // Phase 6: Commerce Intelligence, Optimization & Decision Engine Collections
  analytics_events: Array<{ id: string; tenant_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>;
  metric_definitions: MetricDefinition[];
  metric_snapshots: MetricSnapshot[];
  insights: Insight[];
  anomalies: Anomaly[];
  opportunities: Opportunity[];
  risks: Risk[];
  recommendations: Recommendation[];
  forecast_runs: ForecastRun[];
  simulations: SimulationResult[];
  decision_requests: DecisionRequest[];
  decision_outcomes: DecisionOutcome[];
  customer_intelligence: CustomerIntelligenceRecord[];
  product_performance: ProductPerformanceSnapshot[];
  inventory_intelligence: InventoryIntelligenceSnapshot[];
  cohort_records: CohortRecord[];
  intelligence_runs: IntelligenceRun[];
  model_registry: ModelRegistryEntry[];
  data_quality_reports: DataQualityReport[];
  // Phase 7: Autonomous Growth, Marketing & Customer Lifecycle Collections
  audiences: Audience[];
  audience_members: AudienceMember[];
  audience_snapshots: AudienceSnapshot[];
  customer_lifecycles: CustomerLifecycleRecord[];
  customer_lifecycle_transitions: CustomerLifecycleTransition[];
  journeys: CustomerJourney[];
  journey_enrollments: JourneyEnrollment[];
  journey_executions: JourneyExecutionRecord[];
  campaigns: GrowthCampaign[];
  campaign_executions: CampaignExecutionRecord[];
  content_assets: ContentAsset[];
  content_templates: ContentTemplate[];
  offers: GrowthOffer[];
  offer_usages: OfferUsage[];
  experiments: GrowthExperiment[];
  experiment_assignments: ExperimentAssignment[];
  communication_preferences: CustomerCommunicationPreference[];
  suppression_list: SuppressionEntry[];
  campaign_attributions: CampaignAttribution[];
  growth_insights: GrowthInsight[];
  growth_recommendations: GrowthRecommendation[];
  abandoned_carts: AbandonedCartRecoveryItem[];
  executive_digests: ExecutiveDigest[];
  // Phase 8: Autonomous Commerce Operations Collections
  suppliers: Supplier[];
  supplier_products: SupplierProduct[];
  purchase_orders: PurchaseOrder[];
  procurement_recommendations: ProcurementRecommendation[];
  supplier_performances: SupplierPerformance[];
  pricing_rules: PricingRule[];
  pricing_recommendations: PricingRecommendation[];
  price_change_requests: PriceChangeRequest[];
  price_change_executions: PriceChangeExecution[];
  shipment_exceptions: ShipmentException[];
  courier_performances: CourierPerformance[];
  fulfillment_plans: FulfillmentPlan[];
  payment_operations: PaymentOperation[];
  payment_exceptions: PaymentException[];
  reconciliation_runs: ReconciliationRun[];
  reconciliation_items: ReconciliationItem[];
  financial_exceptions: FinancialException[];
  settlement_records: SettlementRecord[];
  support_tickets: SupportTicket[];
  operational_exceptions: OperationalException[];
  exception_policies: ExceptionPolicy[];
  provider_health: ProviderHealth[];
  provider_incidents: ProviderIncident[];
  sla_policies: SLAPolicy[];
  sla_breaches: SLABreach[];
  autonomy_budgets: AutonomyBudget[];
  bulk_safeguards: BulkOperationSafeguard[];
  // Phase 9: Enterprise Commerce Intelligence & Ecosystem Collections
  organizations: Organization[];
  business_units: BusinessUnit[];
  brand_groups: BrandGroup[];
  enterprise_brands: EnterpriseBrand[];
  enterprise_stores: EnterpriseStore[];
  sales_channels: SalesChannel[];
  regions: Region[];
  entity_memberships: EntityMembership[];
  enterprise_users: EnterpriseUserRecord[];
  semantic_metrics: EnterpriseMetricDefinition[];
  enterprise_benchmarks: EnterpriseBenchmark[];
  report_definitions: ReportDefinition[];
  report_executions: ReportExecution[];
  integration_providers: IntegrationProvider[];
  integration_installations: IntegrationInstallation[];
  integration_mappings: IntegrationMapping[];
  integration_conflicts: IntegrationConflict[];
  integration_syncs: IntegrationSyncRecord[];
  developer_applications: DeveloperApplication[];
  api_keys: APIKeyRecord[];
  enterprise_webhooks: EnterpriseWebhookSubscription[];
  webhook_deliveries: WebhookDeliveryRecord[];
  data_assets: DataAsset[];
  data_lineage: DataLineageTrace[];
  data_quality_rules: DataQualityRule[];
  data_quality_issues: DataQualityIssue[];
  enterprise_customer_identities: EnterpriseCustomerIdentity[];
  enterprise_incidents: EnterpriseIncident[];
  enterprise_ai_budgets: EnterpriseAIBudget[];
  ai_usage_records: EnterpriseAIUsageRecord[];
  // Phase 10: Autonomous Commerce Platform Collections
  business_objectives: BusinessObjective[];
  objective_runs: ObjectiveRun[];
  objective_outcomes: ObjectiveOutcome[];
  strategies: Strategy[];
  global_decisions: GlobalDecision[];
  cross_domain_messages: CrossDomainAgentMessage[];
  agent_proposals: AgentProposal[];
  agent_conflicts: AgentConflict[];
  learning_candidates: LearningCandidate[];
  ai_models: AIModel[];
  model_deployments: ModelDeployment[];
  ai_providers: AIProvider[];
  autonomy_recommendations: AutonomyRecommendation[];
  platform_health_records: PlatformHealth[];
  slo_definitions: SLODefinition[];
  error_budgets: ErrorBudget[];
  data_residency_policies: DataResidencyPolicy[];
  global_events: GlobalEventEnvelope[];
  extensions: Extension[];
  plugins: Plugin[];
  platform_cost_records: PlatformCostRecord[];
  autonomous_quality_scores: AutonomousQualityScorecard[];
  autonomous_workflow_runs: AutonomousWorkflowRun[];
  chaos_test_scenarios: ChaosTestScenario[];
  load_test_scenarios: LoadTestScenario[];
  rollback_actions: RollbackAction[];
  automations: AutomationRecord[];
  automation_workflows: AutomationWorkflow[];
  automation_workflow_versions: AutomationWorkflowVersion[];
  n8n_instances: N8nInstance[];
  automation_triggers: AutomationTrigger[];
  automation_executions: AutomationExecution[];
  automation_execution_steps: AutomationExecutionStep[];
  idempotency_records: IdempotencyRecord[];
  automation_retries: AutomationRetry[];
  automation_dead_letters: AutomationDeadLetter[];
  automation_webhooks: AutomationWebhook[];
  automation_webhook_deliveries: AutomationWebhookDelivery[];
  automation_audit_logs: AutomationAuditRecord[];
  connector_configurations: ConnectorConfigRecord[];
  // Phase 12: Platform & Super Admin Collections
  platform_memberships: PlatformMembershipRecord[];
  service_tokens: ServiceTokenRecord[];
  plans: PlanRecord[];
  plan_versions: PlanVersionRecord[];
  subscriptions: SubscriptionRecord[];
  entitlements: EntitlementRecord[];
  tenant_entitlements: TenantEntitlementRecord[];
  usage_records: UsageRecordRecord[];
  platform_feature_flags: PlatformFeatureFlagRecord[];
  platform_settings: PlatformSettingRecord[];
  platform_setting_versions: PlatformSettingVersionRecord[];
  platform_incidents: PlatformIncidentRecord[];
  platform_maintenance_windows: PlatformMaintenanceWindowRecord[];
  platform_audit_logs: PlatformAuditLogRecord[];
  platform_kill_switches: PlatformKillSwitchRecord[];
  platform_security_events: PlatformSecurityEventRecord[];
  platform_announcements: PlatformAnnouncementRecord[];
  platform_api_keys: PlatformApiKeyRecord[];
  impersonation_sessions: ImpersonationSessionRecord[];
}

/**
 * Drops identity fields from a patch before it is merged into a stored record, so no update can move a record to
 * another tenant or change its id or creation time, whatever a caller forwards (FX-12, audit H4 defense in depth).
 */
function safePatch<T extends object>(patch: T): T {
  const { id: _id, tenant_id: _tenantId, created_at: _createdAt, ...rest } = patch as Record<string, unknown>;
  return rest as T;
}

export type PersistenceBlockedCode =
  | "DATA_DIR_UNAVAILABLE"
  | "LOCK_UNAVAILABLE"
  | "LOCK_HELD_BY_OTHER_PROCESS"
  | "LOCK_HELD_ON_OTHER_HOST"
  | "DATA_FILE_UNREADABLE"
  | "DATA_FILE_CORRUPT"
  | "LOCK_LOST"
  | "DATABASE_NOT_CONFIGURED"
  | "DATABASE_UNAVAILABLE"
  | "SCHEMA_MISSING";

/** Where the store is persisted (ADR-108): the JSON file (default until cutover) or Postgres. */
export type StoreBackend = "json" | "pg";

export interface StoreOptions {
  /** Default: DATA_BACKEND ("pg" selects Postgres; anything else the JSON file). */
  backend?: StoreBackend;
  /** Postgres client; default Neon via DATABASE_URL_POOLED / DATABASE_URL. Tests and rehearsals pass PGlite. */
  client?: SqlClient;
  /** Persistence on/off. Default: on, except under NODE_ENV=test and in Next.js helper processes. */
  persist?: boolean;
  /** The process-wide store of a server or script: retries an unreachable database and exits when it can't own the store. */
  serverMode?: boolean;
  /** Default true. False: the data exactly as stored, without the default seed (the backfill's read-only source). */
  seed?: boolean;
}

/** Thrown by `db.data` before a Postgres-backed store has loaded; routes answer 503. */
export class StoreNotReadyError extends AppError {
  constructor() {
    super("STORE_NOT_READY", "The data store is still loading. Try again shortly.", 503);
  }
}

class StartupRefusal extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Writes stop after half the lease TTL without confirmation; reads after 80% (before another process may take over). */
const LEASE_WRITE_FENCE = 0.5;
const LEASE_READ_FENCE = 0.8;

export interface PersistenceHealth {
  ok: boolean;
  backend: StoreBackend;
  /** False until a Postgres-backed store has loaded its data. */
  ready: boolean;
  data_dir: string;
  dirty: boolean;
  last_persist_at: string | null;
  last_persist_error: { at: string; message: string } | null;
  blocked_reason: string | null;
  /** Public reason code for /health/ready; `blocked_reason` has paths and pids and stays internal (review L-1). */
  blocked_code: PersistenceBlockedCode | null;
  lock: { held: boolean; path: string; owner?: { pid: number; host: string; started_at: string } };
  debounce_ms: number;
  /** Records not saved as they are in memory: refused by Postgres, or without a usable id. Health is not ok while > 0. */
  unsaved_rows: number;
}

export class CommerceDatabase {
  private _data: DatabaseSchema | null = null;
  /** The working set. A Postgres-backed store throws 503 STORE_NOT_READY here until ready() has loaded it. */
  public get data(): DatabaseSchema {
    if (!this._data) throw new StoreNotReadyError();
    if (this.fenced || (this.pg && this.leaseStale(LEASE_READ_FENCE))) {
      // Another process may own the store by now: memory could be stale (a revoked membership, a changed price).
      throw new AppError("STORE_UNAVAILABLE", "The data store is unavailable right now. Try again shortly.", 503);
    }
    return this._data;
  }
  public set data(value: DatabaseSchema) {
    this._data = value;
  }
  public readonly backend: StoreBackend;
  private readonly options: StoreOptions;
  private readonly persistenceEnabled: boolean;
  private readonly serverMode: boolean;
  private pg: PgStorePersistence | null = null;
  private readyPromise: Promise<void> | null = null;
  private leaseHeld = false;
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  /** When this process last proved it holds the lease (acquire, renewal, or a committed write). */
  private leaseConfirmedAt = 0;
  /** Set when the lease was lost (tests and scripts; a server exits instead). */
  private fenced = false;
  private pingCache: { at: number; ok: boolean } | null = null;
  private pingInFlight: Promise<boolean> | null = null;
  private reportedUnwritable = 0;
  private reportedSanitized = 0;
  private filePath: string;
  private dataDir: string;
  private isTestInstance = false;
  /**
   * Next.js evaluates route modules in helper processes (the dev static-paths worker, `next build` workers). They only
   * need the module to load: they never own, lock or write the store (Phase 2 live check: taking the lock there broke
   * dynamic routes while the dev server ran).
   */
  private readonly helperProcess = CommerceDatabase.isNextHelperProcess();

  /**
   * Next's jest-worker children run `jest-worker/processChild.js` (Next replaces their env, so JEST_WORKER_ID is lost);
   * worker threads aren't the main thread; `next build` sets NEXT_PHASE for itself and its workers.
   */
  private static isNextHelperProcess(): boolean {
    if (process.env.NEXT_PHASE === "phase-production-build") return true;
    if (/jest-worker[\\/](processChild|threadChild)\.js$/.test(process.argv[1] ?? "")) return true;
    if (process.env.JEST_WORKER_ID) return true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return !(require("worker_threads") as typeof import("worker_threads")).isMainThread;
    } catch {
      return false;
    }
  }

  // ---- Coalesced asynchronous persistence (FIX_IMPLEMENTATION_PLAN FX-20, audit C6/C7) ----
  // Mutations mark the store dirty; one flush per debounce window writes a compact snapshot to a temp file, fsyncs it and
  // renames it over the data file. Failures are kept, reported by /health/ready and retried, never swallowed.
  // Trade-off: acknowledged writes from the last debounce window (+ write time) can be lost on a crash. Phase 4
  // (Postgres) removes this.
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private dirty = false;
  public lastPersistError: { at: string; message: string } | null = null;
  public lastPersistAt: string | null = null;
  /** Set when writing would be unsafe (the data file couldn't be read, or another process owns the store). */
  private persistenceBlocked: string | null = null;
  private blockedCode: PersistenceBlockedCode | null = null;
  /** Every persist/markDirty call, counted even in tests: lets tests prove a request asked for no write (FX-21). */
  private writeSignals = 0;
  private readonly debounceMs = envNumber("PERSIST_DEBOUNCE_MS", 250, 0);
  private lockPath: string;
  private lockHeld = false;
  /** The lock content this process wrote; flush() checks the file still says so (review N-2). */
  private lockOwner: { pid: number; host: string; started_at: string } | null = null;

  constructor(options: StoreOptions = {}) {
    this.options = options;
    this.backend = options.backend ?? (process.env.DATA_BACKEND === "pg" ? "pg" : "json");
    this.persistenceEnabled = options.persist ?? (process.env.NODE_ENV !== "test" && !this.helperProcess);
    this.serverMode = options.serverMode ?? false;
    this.dataDir = process.env.COMMERCEOS_DATA_DIR ? path.resolve(process.env.COMMERCEOS_DATA_DIR) : path.join(process.cwd(), ".data");
    this.filePath = path.join(this.dataDir, "commerceos.json");
    this.lockPath = path.join(this.dataDir, "commerceos.lock");
    if (this.backend === "pg") {
      // Postgres (ADR-108): ready() takes the writer lease and loads the data. Without persistence (tests, Next.js helper
      // processes) the store is in memory, as the JSON backend is under NODE_ENV=test.
      if (!this.persistenceEnabled) {
        this._data = CommerceDatabase.emptySchema();
        if (options.seed !== false) this.ensureDefaultSeed();
        this.readyPromise = Promise.resolve();
      }
      return;
    }
    this.readyPromise = Promise.resolve();
    const persistent = this.persistenceEnabled;
    if (persistent) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (err) {
        this.block("DATA_DIR_UNAVAILABLE", `Data directory ${this.dataDir} can't be created: ${(err as Error).message}`);
        logger.error("db.data_dir_unavailable", { data_dir: this.dataDir, error: (err as Error).message });
      }
      if (!this.persistenceBlocked) this.acquireWriterLock();
    }
    this.data = this.loadData();
    if (persistent && !this.persistenceBlocked) this.quarantineStaleTempFiles();
    if (persistent && this.persistenceBlocked) this.refuseToStart();
    // While blocked the store serves reads only; seeding would be a write that can never be saved (review L-2).
    if (!this.persistenceBlocked && options.seed !== false) this.ensureDefaultSeed();
  }

  /**
   * FX-24: a process that can't own the store refuses to start, so a second `next dev`, script or replica never runs
   * with changes it can't save. There is deliberately no read-only mode: store methods change memory before they
   * persist, so a "read-only" process would still act on writes it then refuses (review N-5).
   */
  private refuseToStart(): void {
    const why =
      this.blockedCode === "LOCK_HELD_BY_OTHER_PROCESS"
        ? "the data store is in use by another process"
        : this.blockedCode === "LOCK_HELD_ON_OTHER_HOST"
          ? "the data store is in use by another host"
          : this.blockedCode === "LOCK_LOST"
            ? "another process took over the data store"
            : this.blockedCode === "SCHEMA_MISSING"
            ? "the database has no CommerceOS schema yet (run `npm run db:migrate`)"
            : this.blockedCode === "DATABASE_NOT_CONFIGURED"
              ? "DATA_BACKEND=pg is set but DATABASE_URL is not"
              : "the data store can't be written";
    logger.error("db.refusing_to_start", { code: this.blockedCode, reason: this.persistenceBlocked });
    process.stderr.write(
      `CommerceOS refused to start: ${why} (${this.blockedCode}). ${this.persistenceBlocked}\n` +
        (this.blockedCode?.startsWith("LOCK_")
          ? "Stop the other process first. Two writers lose each other's changes.\n"
          : "Nothing unsaved was acknowledged. Check the database, then start again.\n")
    );
    process.exit(1);
  }

  /** Releases lapsed holds at boot and every 5 minutes, in the store-owning process only (FX-35 step 3). */
  private startReservationSweeper(): void {
    const sweep = () => {
      try {
        const released = this.releaseExpiredReservations();
        if (released) logger.info("reservations.expired_released", { released });
      } catch (err) {
        logger.error("reservations.sweep_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    };
    setTimeout(sweep, 5_000).unref();
    setInterval(sweep, 5 * 60 * 1000).unref();
  }

  private block(code: PersistenceBlockedCode, detail: string): void {
    this.persistenceBlocked = detail;
    this.blockedCode = code;
  }

  /**
   * Single-writer guard (FX-24, audit C7): only one process may own the JSON store. A second `next dev`, a seed script
   * or another replica would overwrite this process's writes (and vice versa). A stale lock from a dead process is taken
   * over; a lock held by a live process blocks persistence here and /health/ready reports it.
   */
  private acquireWriterLock(): void {
    const owner = { pid: process.pid, host: os.hostname(), started_at: new Date().toISOString() };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        fs.writeSync(fd, JSON.stringify(owner));
        fs.closeSync(fd);
        this.lockHeld = true;
        this.lockOwner = owner;
        this.startReservationSweeper();
        const release = () => {
          try {
            const current = JSON.parse(fs.readFileSync(this.lockPath, "utf-8")) as { pid?: number; started_at?: string };
            if (current.pid === process.pid && current.started_at === owner.started_at) fs.rmSync(this.lockPath, { force: true });
          } catch {
            // lock already gone
          }
        };
        process.once("exit", release);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          this.block("LOCK_UNAVAILABLE", `Writer lock ${this.lockPath} can't be created: ${(err as Error).message}`);
          return;
        }
        const state = CommerceDatabase.readLockState(this.lockPath);
        if (state.kind === "missing") continue; // released between our create attempt and this read: try again
        if (state.kind === "unreadable") {
          // A lock we can't read may belong to a live process (e.g. another user's service): never take it over (N-3).
          this.block("LOCK_UNAVAILABLE", `Writer lock ${this.lockPath} exists but can't be read: ${state.error}`);
          return;
        }
        const holder = state.kind === "ok" ? state.owner : null;
        if (!holder) {
          // Unreadable or still empty: another process may be between creating and writing it. Treat a young file as live.
          if (CommerceDatabase.lockAgeMs(this.lockPath) < 10_000) {
            this.block("LOCK_HELD_BY_OTHER_PROCESS", `Writer lock ${this.lockPath} is being created by another process.`);
            return;
          }
        } else if (holder.host !== os.hostname()) {
          // Another host (container, replica) shares this data directory. Its pid can't be checked from here, so refuse
          // rather than take the lock over (review M-2). An operator who knows the holder is gone can force it.
          if (process.env.COMMERCEOS_FORCE_LOCK !== "1") {
            this.block("LOCK_HELD_ON_OTHER_HOST", `The data store is locked by host ${holder.host} (pid ${holder.pid}). Only one writer is allowed; set COMMERCEOS_FORCE_LOCK=1 only if that host is gone.`);
            logger.error("db.writer_lock_other_host", { lock: this.lockPath, owner_host: holder.host, owner_pid: holder.pid });
            return;
          }
        } else if (holder.pid !== process.pid && CommerceDatabase.isProcessAlive(holder.pid)) {
          this.block("LOCK_HELD_BY_OTHER_PROCESS", `Another process (pid ${holder.pid}, started ${holder.started_at}) owns the data store. Only one writer is allowed.`);
          logger.error("db.writer_lock_held", { lock: this.lockPath, owner_pid: holder.pid, owner_started_at: holder.started_at });
          return;
        }
        // Stale lock: claim it with an atomic rename (only one process can move a given file), then check that the file
        // we moved is the stale one we inspected, not a lock another process created meanwhile (review M-2).
        const claimed = `${this.lockPath}.stale.${process.pid}.${Date.now()}`;
        try {
          fs.renameSync(this.lockPath, claimed);
        } catch {
          continue; // someone else claimed or replaced it first: look again
        }
        const moved = CommerceDatabase.readLockOwner(claimed);
        if ((moved?.pid ?? null) !== (holder?.pid ?? null) || (moved?.started_at ?? null) !== (holder?.started_at ?? null)) {
          try {
            fs.renameSync(claimed, this.lockPath); // put the other process's fresh lock back
          } catch {
            // it re-created one already
          }
          this.block("LOCK_HELD_BY_OTHER_PROCESS", "Another process took over the data store lock at the same time. Only one writer is allowed.");
          return;
        }
        fs.rmSync(claimed, { force: true });
        logger.warn("db.writer_lock_stale", { lock: this.lockPath, owner_pid: holder?.pid, owner_host: holder?.host });
      }
    }
    this.block("LOCK_UNAVAILABLE", `Writer lock ${this.lockPath} could not be acquired.`);
  }

  private static lockAgeMs(lockPath: string): number {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  public static readLockOwner(lockPath: string): { pid: number; host: string; started_at: string } | null {
    const state = CommerceDatabase.readLockState(lockPath);
    return state.kind === "ok" ? state.owner : null;
  }

  /** Missing, unreadable (permissions, busy), invalid (empty or not an owner record) or a valid owner. */
  public static readLockState(
    lockPath: string
  ):
    | { kind: "missing" }
    | { kind: "unreadable"; error: string }
    | { kind: "invalid" }
    | { kind: "ok"; owner: { pid: number; host: string; started_at: string } } {
    let raw: string;
    try {
      raw = fs.readFileSync(lockPath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable", error: code ?? (err as Error).message };
    }
    try {
      const owner = JSON.parse(raw) as { pid?: unknown; host?: unknown; started_at?: unknown };
      if (typeof owner.pid === "number" && typeof owner.host === "string" && typeof owner.started_at === "string") {
        return { kind: "ok", owner: { pid: owner.pid, host: owner.host, started_at: owner.started_at } };
      }
    } catch {
      // fall through
    }
    return { kind: "invalid" };
  }

  /** True while the lock file still names this process (review N-2/N-4: fencing before every write). */
  private stillOwnsLock(): boolean {
    const current = CommerceDatabase.readLockOwner(this.lockPath);
    return (
      !!current &&
      !!this.lockOwner &&
      current.pid === this.lockOwner.pid &&
      current.host === this.lockOwner.host &&
      current.started_at === this.lockOwner.started_at
    );
  }

  public static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  /** Temp files left by a crash may hold writes that never reached the data file: keep them, don't delete (FX-20). */
  private quarantineStaleTempFiles(): void {
    try {
      const stale = fs.readdirSync(this.dataDir).filter((f) => f.startsWith("commerceos.json.tmp"));
      if (stale.length === 0) return;
      const quarantine = path.join(this.dataDir, "quarantine");
      fs.mkdirSync(quarantine, { recursive: true });
      for (const name of stale) {
        const from = path.join(this.dataDir, name);
        const mtime = fs.statSync(from).mtime.toISOString();
        fs.renameSync(from, path.join(quarantine, name));
        logger.warn("db.stale_temp_quarantined", { file: name, mtime });
      }
    } catch (err) {
      logger.error("db.quarantine_failed", { error: (err as Error).message });
    }
  }

  public getPersistenceHealth(): PersistenceHealth {
    if (this.backend === "pg") return this.postgresHealth();
    const owner = this.lockHeld ? undefined : CommerceDatabase.readLockOwner(this.lockPath) ?? undefined;
    return {
      ok: !this.persistenceBlocked && !this.lastPersistError && (this.lockHeld || this.isTestInstance || process.env.NODE_ENV === "test"),
      backend: "json",
      ready: true,
      unsaved_rows: 0,
      data_dir: this.dataDir,
      dirty: this.dirty,
      last_persist_at: this.lastPersistAt,
      last_persist_error: this.lastPersistError,
      blocked_reason: this.persistenceBlocked,
      blocked_code: this.blockedCode,
      lock: { held: this.lockHeld, path: this.lockPath, ...(owner ? { owner } : {}) },
      debounce_ms: this.debounceMs,
    };
  }

  /** A complete store from parsed data (the JSON file or Postgres): every collection present, legacy values normalized. */
  public static fromParsed(parsed: Partial<DatabaseSchema>): DatabaseSchema {
    return {
      tenants: parsed.tenants || [],
      users: parsed.users || [],
      memberships: parsed.memberships || [],
      invitations: parsed.invitations || [],
      audit_logs: parsed.audit_logs || [],
      products: parsed.products || [],
      product_variants: parsed.product_variants || [],
      categories: parsed.categories || [],
      brands: parsed.brands || [],
      warehouses: parsed.warehouses || [],
      inventory_items: parsed.inventory_items || [],
      stock_movements: parsed.stock_movements || [],
      inventory_reservations: parsed.inventory_reservations || [],
      order_sequences: parsed.order_sequences || {},
      customers: parsed.customers || [],
      customer_addresses: parsed.customer_addresses || [],
      orders: parsed.orders || [],
      order_items: parsed.order_items || [],
      payments: parsed.payments || [],
      shipments: parsed.shipments || [],
      returns: parsed.returns || [],
      refunds: parsed.refunds || [],
      coupons: parsed.coupons || [],
      events: parsed.events || [],
      webhooks: parsed.webhooks || [],
      connected_channels: parsed.connected_channels || [],
      customer_identities: parsed.customer_identities || [],
      conversations: parsed.conversations || [],
      messages: parsed.messages || [],
      conversation_assignments: parsed.conversation_assignments || [],
      conversation_tags: parsed.conversation_tags || [],
      leads: parsed.leads || [],
      attachments: parsed.attachments || [],
      quick_replies: parsed.quick_replies || [],
      business_hours: parsed.business_hours || [],
      chat_sessions: parsed.chat_sessions || [],
      outbound_webhook_deliveries: parsed.outbound_webhook_deliveries || [],
      agents: parsed.agents || [],
      agent_policies: parsed.agent_policies || [],
      agent_runs: parsed.agent_runs || [],
      agent_tool_calls: parsed.agent_tool_calls || [],
      agent_prompts: parsed.agent_prompts || [],
      prompt_versions: parsed.prompt_versions || [],
      conversation_summaries: parsed.conversation_summaries || [],
      customer_memories: parsed.customer_memories || [],
      knowledge_documents: parsed.knowledge_documents || [],
      knowledge_chunks: parsed.knowledge_chunks || [],
      ai_traces: parsed.ai_traces || [],
      ai_usage: parsed.ai_usage || [],
      ai_feedback: parsed.ai_feedback || [],
      // Phase 5 Collections
      workflows: parsed.workflows || [],
      tasks: parsed.tasks || [],
      agent_messages: parsed.agent_messages || [],
      workflow_contexts: parsed.workflow_contexts || [],
      workflow_artifacts: parsed.workflow_artifacts || [],
      workflow_checkpoints: parsed.workflow_checkpoints || [],
      agent_delegations: parsed.agent_delegations || [],
      agent_verifications: parsed.agent_verifications || [],
      approval_requests: parsed.approval_requests || [],
      autonomy_policies: parsed.autonomy_policies || [],
      workflow_templates: parsed.workflow_templates || [],
      trigger_rules: parsed.trigger_rules || [],
      action_receipts: parsed.action_receipts || [],
      agent_schedules: parsed.agent_schedules || [],
      // Phase 6 Collections
      analytics_events: parsed.analytics_events || [],
      metric_definitions: parsed.metric_definitions || [],
      metric_snapshots: parsed.metric_snapshots || [],
      insights: parsed.insights || [],
      anomalies: parsed.anomalies || [],
      opportunities: parsed.opportunities || [],
      risks: parsed.risks || [],
      recommendations: parsed.recommendations || [],
      forecast_runs: parsed.forecast_runs || [],
      simulations: parsed.simulations || [],
      decision_requests: parsed.decision_requests || [],
      decision_outcomes: parsed.decision_outcomes || [],
      customer_intelligence: parsed.customer_intelligence || [],
      product_performance: parsed.product_performance || [],
      inventory_intelligence: parsed.inventory_intelligence || [],
      cohort_records: parsed.cohort_records || [],
      intelligence_runs: parsed.intelligence_runs || [],
      model_registry: parsed.model_registry || [],
      data_quality_reports: parsed.data_quality_reports || [],
      // Phase 7 Collections
      audiences: parsed.audiences || [],
      audience_members: parsed.audience_members || [],
      audience_snapshots: parsed.audience_snapshots || [],
      customer_lifecycles: parsed.customer_lifecycles || [],
      customer_lifecycle_transitions: parsed.customer_lifecycle_transitions || [],
      journeys: parsed.journeys || [],
      journey_enrollments: parsed.journey_enrollments || [],
      journey_executions: parsed.journey_executions || [],
      campaigns: parsed.campaigns || [],
      campaign_executions: parsed.campaign_executions || [],
      content_assets: parsed.content_assets || [],
      content_templates: parsed.content_templates || [],
      offers: parsed.offers || [],
      offer_usages: parsed.offer_usages || [],
      experiments: parsed.experiments || [],
      experiment_assignments: parsed.experiment_assignments || [],
      communication_preferences: parsed.communication_preferences || [],
      suppression_list: parsed.suppression_list || [],
      campaign_attributions: parsed.campaign_attributions || [],
      growth_insights: parsed.growth_insights || [],
      growth_recommendations: parsed.growth_recommendations || [],
      abandoned_carts: parsed.abandoned_carts || [],
      executive_digests: parsed.executive_digests || [],
      // Phase 8 Collections
      suppliers: parsed.suppliers || [],
      supplier_products: parsed.supplier_products || [],
      purchase_orders: parsed.purchase_orders || [],
      procurement_recommendations: parsed.procurement_recommendations || [],
      supplier_performances: parsed.supplier_performances || [],
      pricing_rules: parsed.pricing_rules || [],
      pricing_recommendations: parsed.pricing_recommendations || [],
      price_change_requests: parsed.price_change_requests || [],
      price_change_executions: parsed.price_change_executions || [],
      shipment_exceptions: parsed.shipment_exceptions || [],
      courier_performances: parsed.courier_performances || [],
      fulfillment_plans: parsed.fulfillment_plans || [],
      payment_operations: parsed.payment_operations || [],
      payment_exceptions: parsed.payment_exceptions || [],
      reconciliation_runs: parsed.reconciliation_runs || [],
      reconciliation_items: parsed.reconciliation_items || [],
      financial_exceptions: parsed.financial_exceptions || [],
      settlement_records: parsed.settlement_records || [],
      support_tickets: parsed.support_tickets || [],
      operational_exceptions: parsed.operational_exceptions || [],
      exception_policies: parsed.exception_policies || [],
      provider_health: parsed.provider_health || [],
      provider_incidents: parsed.provider_incidents || [],
      sla_policies: parsed.sla_policies || [],
      sla_breaches: parsed.sla_breaches || [],
      autonomy_budgets: parsed.autonomy_budgets || [],
      bulk_safeguards: parsed.bulk_safeguards || [],
      // Phase 9 Collections
      // Legacy: every workspace used to share "org_default"; it belongs to the demo workspace now (FX-13).
      organizations: (parsed.organizations || []).map((o: Organization) =>
        o.id === "org_default" && !o.tenant_id ? { ...o, tenant_id: "ten_default_dhaka" } : o
      ),
      business_units: parsed.business_units || [],
      brand_groups: parsed.brand_groups || [],
      enterprise_brands: parsed.enterprise_brands || [],
      enterprise_stores: parsed.enterprise_stores || [],
      sales_channels: parsed.sales_channels || [],
      regions: parsed.regions || [],
      entity_memberships: parsed.entity_memberships || [],
      enterprise_users: parsed.enterprise_users || [],
      semantic_metrics: parsed.semantic_metrics || [],
      enterprise_benchmarks: parsed.enterprise_benchmarks || [],
      report_definitions: parsed.report_definitions || [],
      report_executions: parsed.report_executions || [],
      integration_providers: parsed.integration_providers || [],
      integration_installations: parsed.integration_installations || [],
      integration_mappings: parsed.integration_mappings || [],
      integration_conflicts: parsed.integration_conflicts || [],
      integration_syncs: parsed.integration_syncs || [],
      developer_applications: parsed.developer_applications || [],
      api_keys: parsed.api_keys || [],
      enterprise_webhooks: parsed.enterprise_webhooks || [],
      webhook_deliveries: parsed.webhook_deliveries || [],
      data_assets: parsed.data_assets || [],
      data_lineage: parsed.data_lineage || [],
      data_quality_rules: parsed.data_quality_rules || [],
      data_quality_issues: parsed.data_quality_issues || [],
      enterprise_customer_identities: parsed.enterprise_customer_identities || [],
      enterprise_incidents: parsed.enterprise_incidents || [],
      enterprise_ai_budgets: parsed.enterprise_ai_budgets || [],
      ai_usage_records: parsed.ai_usage_records || [],
      // Phase 10 Collections
      business_objectives: parsed.business_objectives || [],
      objective_runs: parsed.objective_runs || [],
      objective_outcomes: parsed.objective_outcomes || [],
      strategies: parsed.strategies || [],
      global_decisions: parsed.global_decisions || [],
      cross_domain_messages: parsed.cross_domain_messages || [],
      agent_proposals: parsed.agent_proposals || [],
      agent_conflicts: parsed.agent_conflicts || [],
      learning_candidates: parsed.learning_candidates || [],
      ai_models: parsed.ai_models || [],
      model_deployments: parsed.model_deployments || [],
      ai_providers: parsed.ai_providers || [],
      autonomy_recommendations: parsed.autonomy_recommendations || [],
      platform_health_records: parsed.platform_health_records || [],
      slo_definitions: parsed.slo_definitions || [],
      error_budgets: parsed.error_budgets || [],
      data_residency_policies: parsed.data_residency_policies || [],
      global_events: parsed.global_events || [],
      extensions: parsed.extensions || [],
      plugins: parsed.plugins || [],
      platform_cost_records: parsed.platform_cost_records || [],
      autonomous_quality_scores: parsed.autonomous_quality_scores || [],
      autonomous_workflow_runs: parsed.autonomous_workflow_runs || [],
      chaos_test_scenarios: parsed.chaos_test_scenarios || [],
      load_test_scenarios: parsed.load_test_scenarios || [],
      rollback_actions: parsed.rollback_actions || [],
      automations: parsed.automations || [],
      automation_workflows: parsed.automation_workflows || [],
      automation_workflow_versions: parsed.automation_workflow_versions || [],
      n8n_instances: parsed.n8n_instances || [],
      automation_triggers: parsed.automation_triggers || [],
      automation_executions: parsed.automation_executions || [],
      automation_execution_steps: parsed.automation_execution_steps || [],
      idempotency_records: parsed.idempotency_records || [],
      automation_retries: parsed.automation_retries || [],
      automation_dead_letters: parsed.automation_dead_letters || [],
      automation_webhooks: parsed.automation_webhooks || [],
      automation_webhook_deliveries: parsed.automation_webhook_deliveries || [],
      automation_audit_logs: parsed.automation_audit_logs || [],
      connector_configurations: parsed.connector_configurations || [],
      service_tokens: parsed.service_tokens || [],
      // MFA was recorded as enabled without any factor existing (STATUS N4); only an enrolled secret counts.
      platform_memberships: (parsed.platform_memberships || []).map((m: PlatformMembershipRecord) =>
        m.mfa_enabled && !m.mfa_secret_encrypted ? { ...m, mfa_enabled: false } : m
      ),
      plans: parsed.plans || [],
      plan_versions: parsed.plan_versions || [],
      subscriptions: parsed.subscriptions || [],
      entitlements: parsed.entitlements || [],
      tenant_entitlements: parsed.tenant_entitlements || [],
      usage_records: parsed.usage_records || [],
      platform_feature_flags: parsed.platform_feature_flags || [],
      platform_settings: parsed.platform_settings || [],
      platform_setting_versions: parsed.platform_setting_versions || [],
      platform_incidents: parsed.platform_incidents || [],
      platform_maintenance_windows: parsed.platform_maintenance_windows || [],
      platform_audit_logs: parsed.platform_audit_logs || [],
      platform_kill_switches: parsed.platform_kill_switches || [],
      platform_security_events: parsed.platform_security_events || [],
      platform_announcements: parsed.platform_announcements || [],
      platform_api_keys: parsed.platform_api_keys || [],
      impersonation_sessions: parsed.impersonation_sessions || [],
    };
  }

  public static emptySchema(): DatabaseSchema {
    return CommerceDatabase.fromParsed({});
  }

  private loadData(): DatabaseSchema {
    let raw: string | null = null;
    try {
      if (fs.existsSync(this.filePath)) raw = fs.readFileSync(this.filePath, "utf-8");
    } catch (err) {
      // The file exists but can't be read (locked, permissions): never start writing an empty store over it (FX-20).
      this.block("DATA_FILE_UNREADABLE", `Data file ${this.filePath} can't be read: ${(err as Error).message}`);
      logger.error("db.data_file_unreadable", { file: this.filePath, error: (err as Error).message });
    }
    try {
      if (raw !== null) {
        return CommerceDatabase.fromParsed(JSON.parse(raw) as Partial<DatabaseSchema>);
      }
    } catch (err) {
      // Corrupt JSON: keep it aside (never delete) so it can be inspected or repaired, then start from seeds.
      try {
        if (fs.existsSync(this.filePath)) {
          const backupPath = `${this.filePath}.corrupted.${Date.now()}`;
          fs.renameSync(this.filePath, backupPath);
          logger.error("db.data_file_corrupt", { file: this.filePath, moved_to: backupPath, error: (err as Error).message });
        }
      } catch (moveErr) {
        this.block("DATA_FILE_CORRUPT", `Corrupt data file could not be moved aside: ${(moveErr as Error).message}`);
      }
    }
    return {
      tenants: [],
      users: [],
      memberships: [],
      invitations: [],
      audit_logs: [],
      products: [],
      product_variants: [],
      categories: [],
      brands: [],
      warehouses: [],
      inventory_items: [],
      stock_movements: [],
      inventory_reservations: [],
      order_sequences: {},
      customers: [],
      customer_addresses: [],
      orders: [],
      order_items: [],
      payments: [],
      shipments: [],
      returns: [],
      refunds: [],
      coupons: [],
      events: [],
      webhooks: [],
      connected_channels: [],
      customer_identities: [],
      conversations: [],
      messages: [],
      conversation_assignments: [],
      conversation_tags: [],
      leads: [],
      attachments: [],
      quick_replies: [],
      business_hours: [],
      chat_sessions: [],
      outbound_webhook_deliveries: [],
      agents: [],
      agent_policies: [],
      agent_runs: [],
      agent_tool_calls: [],
      agent_prompts: [],
      prompt_versions: [],
      conversation_summaries: [],
      customer_memories: [],
      knowledge_documents: [],
      knowledge_chunks: [],
      ai_traces: [],
      ai_usage: [],
      ai_feedback: [],
      // Phase 5 Collections
      workflows: [],
      tasks: [],
      agent_messages: [],
      workflow_contexts: [],
      workflow_artifacts: [],
      workflow_checkpoints: [],
      agent_delegations: [],
      agent_verifications: [],
      approval_requests: [],
      autonomy_policies: [],
      workflow_templates: [],
      trigger_rules: [],
      action_receipts: [],
      agent_schedules: [],
      // Phase 6 Collections
      analytics_events: [],
      metric_definitions: [],
      metric_snapshots: [],
      insights: [],
      anomalies: [],
      opportunities: [],
      risks: [],
      recommendations: [],
      forecast_runs: [],
      simulations: [],
      decision_requests: [],
      decision_outcomes: [],
      customer_intelligence: [],
      product_performance: [],
      inventory_intelligence: [],
      cohort_records: [],
      intelligence_runs: [],
      model_registry: [],
      data_quality_reports: [],
      // Phase 7 Collections
      audiences: [],
      audience_members: [],
      audience_snapshots: [],
      customer_lifecycles: [],
      customer_lifecycle_transitions: [],
      journeys: [],
      journey_enrollments: [],
      journey_executions: [],
      campaigns: [],
      campaign_executions: [],
      content_assets: [],
      content_templates: [],
      offers: [],
      offer_usages: [],
      experiments: [],
      experiment_assignments: [],
      communication_preferences: [],
      suppression_list: [],
      campaign_attributions: [],
      growth_insights: [],
      growth_recommendations: [],
      abandoned_carts: [],
      executive_digests: [],
      // Phase 8 Collections
      suppliers: [],
      supplier_products: [],
      purchase_orders: [],
      procurement_recommendations: [],
      supplier_performances: [],
      pricing_rules: [],
      pricing_recommendations: [],
      price_change_requests: [],
      price_change_executions: [],
      shipment_exceptions: [],
      courier_performances: [],
      fulfillment_plans: [],
      payment_operations: [],
      payment_exceptions: [],
      reconciliation_runs: [],
      reconciliation_items: [],
      financial_exceptions: [],
      settlement_records: [],
      support_tickets: [],
      operational_exceptions: [],
      exception_policies: [],
      provider_health: [],
      provider_incidents: [],
      sla_policies: [],
      sla_breaches: [],
      autonomy_budgets: [],
      bulk_safeguards: [],
      // Phase 9 Collections
      organizations: [],
      business_units: [],
      brand_groups: [],
      enterprise_brands: [],
      enterprise_stores: [],
      sales_channels: [],
      regions: [],
      entity_memberships: [],
      enterprise_users: [],
      semantic_metrics: [],
      enterprise_benchmarks: [],
      report_definitions: [],
      report_executions: [],
      integration_providers: [],
      integration_installations: [],
      integration_mappings: [],
      integration_conflicts: [],
      integration_syncs: [],
      developer_applications: [],
      api_keys: [],
      enterprise_webhooks: [],
      webhook_deliveries: [],
      data_assets: [],
      data_lineage: [],
      data_quality_rules: [],
      data_quality_issues: [],
      enterprise_customer_identities: [],
      enterprise_incidents: [],
      enterprise_ai_budgets: [],
      ai_usage_records: [],
      // Phase 10 Collections
      business_objectives: [],
      objective_runs: [],
      objective_outcomes: [],
      strategies: [],
      global_decisions: [],
      cross_domain_messages: [],
      agent_proposals: [],
      agent_conflicts: [],
      learning_candidates: [],
      ai_models: [],
      model_deployments: [],
      ai_providers: [],
      autonomy_recommendations: [],
      platform_health_records: [],
      slo_definitions: [],
      error_budgets: [],
      data_residency_policies: [],
      global_events: [],
      extensions: [],
      plugins: [],
      platform_cost_records: [],
      autonomous_quality_scores: [],
      autonomous_workflow_runs: [],
      chaos_test_scenarios: [],
      load_test_scenarios: [],
      rollback_actions: [],
      automations: [],
      automation_workflows: [],
      automation_workflow_versions: [],
      n8n_instances: [],
      automation_triggers: [],
      automation_executions: [],
      automation_execution_steps: [],
      idempotency_records: [],
      automation_retries: [],
      automation_dead_letters: [],
      automation_webhooks: [],
      automation_webhook_deliveries: [],
      automation_audit_logs: [],
      connector_configurations: [],
      platform_memberships: [],
      service_tokens: [],
      plans: [],
      plan_versions: [],
      subscriptions: [],
      entitlements: [],
      tenant_entitlements: [],
      usage_records: [],
      platform_feature_flags: [],
      platform_settings: [],
      platform_setting_versions: [],
      platform_incidents: [],
      platform_maintenance_windows: [],
      platform_audit_logs: [],
      platform_kill_switches: [],
      platform_security_events: [],
      platform_announcements: [],
      platform_api_keys: [],
      impersonation_sessions: [],
    };
  }

  /** Called by every mutating method: marks the store dirty and schedules one coalesced flush. */
  private persist(): void {
    this.writeSignals++;
    if (this.isTestInstance || !this.persistenceEnabled) return;
    if (this.pg && this.leaseStale(LEASE_WRITE_FENCE)) {
      // Postgres hasn't confirmed our lease for a while (unreachable, or a paused process). Requests are refused before
      // they change anything (assertWritable, in the request context); a change that reached this point anyway is
      // already in memory, so this process stops for good: it would otherwise save the change later, after telling the
      // caller it wasn't saved, and a retry would duplicate it (done-check, Phase 4). A server exits and restarts.
      this.block("DATABASE_UNAVAILABLE", "Postgres did not confirm the store lease in time; this process stopped writing.");
      this.fenced = true;
      logger.error("db.pg_write_fenced", { unsaved_changes: this.dirty });
      if (this.serverMode) this.refuseToStart();
      throw new AppError("STORE_UNAVAILABLE", "The database can't be reached, so nothing can be saved right now. Nothing was saved.", 503);
    }
    if (this.persistenceBlocked) {
      // Never acknowledge a change that can't be saved (review L-2). The in-memory change is discarded with the process.
      throw new AppError("STORE_UNAVAILABLE", "The data store can't save changes right now. Nothing was saved.", 503);
    }
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.debounceMs);
    }
  }

  /** For services that mutate `db.data` directly instead of through a store method. */
  public markDirty(): void {
    this.persist();
  }

  /** How many times a write was requested since start (tests: a GET must not request any). */
  public getWriteSignalCount(): number {
    return this.writeSignals;
  }

  /** Writes the current snapshot if anything changed. Safe to call concurrently; also used on shutdown. */
  public async flush(): Promise<void> {
    if (this.backend === "pg") return this.flushPostgres();
    if (this.flushing) await this.flushing;
    if (!this.dirty || this.persistenceBlocked || this.isTestInstance || !this.persistenceEnabled) return;
    if (!this.stillOwnsLock()) {
      // Someone else holds the lock now (a takeover race, or a host whose pid we couldn't check). Writing would
      // overwrite their data: stop writing, keep our changes unsaved, and report not ready (review N-2/N-4).
      this.lockHeld = false;
      this.block("LOCK_LOST", `The writer lock ${this.lockPath} no longer names this process; writes stopped.`);
      logger.error("db.writer_lock_lost", { lock: this.lockPath, owner: CommerceDatabase.readLockOwner(this.lockPath) });
      return;
    }
    this.dirty = false;
    const tmpPath = `${this.filePath}.tmp`;
    this.flushing = (async () => {
      try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(this.data), "utf-8"); // compact: far smaller than indented
        const fh = await fs.promises.open(tmpPath, "r+");
        await fh.sync();
        await fh.close();
        await fs.promises.rename(tmpPath, this.filePath);
        this.lastPersistError = null;
        this.lastPersistAt = new Date().toISOString();
      } catch (err) {
        this.dirty = true; // retry, never silently drop
        this.lastPersistError = { at: new Date().toISOString(), message: (err as Error).message };
        logger.error("db.persist_failed", { file: this.filePath, error: (err as Error).message });
        await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
        setTimeout(() => void this.flush(), 1000);
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
  }

  // ---- Postgres backend (FIX_IMPLEMENTATION_PLAN FX-42/FX-43, ADR-108) ----
  // The same working set and synchronous API; Postgres is the system of record. ready() takes the single-writer lease
  // (commerceos.store_writer) and loads every table; each coalesced flush writes the changed rows in one transaction.

  /** Resolves once the store has its data: immediately for the JSON file, after lease + load for Postgres. */
  public ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.initializePostgres();
    return this.readyPromise;
  }

  public isReady(): boolean {
    return this._data !== null;
  }

  private async initializePostgres(): Promise<void> {
    let client = this.options.client ?? null;
    if (!client) {
      const url = storeConnectionString();
      if (!url) {
        this.block("DATABASE_NOT_CONFIGURED", "DATA_BACKEND=pg needs DATABASE_URL (or DATABASE_URL_POOLED).");
        return this.failStartup();
      }
      client = createNeonSqlClient(url);
    }
    const pg = new PgStorePersistence(client);
    this.pg = pg;
    let delay = 1_000;
    for (;;) {
      try {
        await this.openPostgres(pg);
        return;
      } catch (err) {
        if (err instanceof StartupRefusal) return this.failStartup();
        this.block("DATABASE_UNAVAILABLE", `Postgres is unreachable: ${(err as Error).message}`);
        logger.error("db.pg_unavailable", { error: (err as Error).message, retry_in_ms: this.serverMode ? delay : null });
        if (!this.serverMode) throw err;
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  private async openPostgres(pg: PgStorePersistence): Promise<void> {
    if (!(await pg.schemaPresent())) {
      this.block("SCHEMA_MISSING", "The commerceos schema is missing: run `npm run db:migrate` (migration 006).");
      throw new StartupRefusal();
    }
    // A writer that stopped without releasing the lease is replaced once its lease expires.
    const deadline = Date.now() + LEASE_TTL_MS + 5_000;
    for (;;) {
      const lease = await pg.acquireLease();
      if (lease.acquired) break;
      const holder = lease.holder;
      if (Date.now() > deadline) {
        this.block(
          "LOCK_HELD_BY_OTHER_PROCESS",
          `Another process (${holder?.host ?? "unknown host"}, pid ${holder?.pid ?? "?"}, since ${holder?.started_at ?? "?"}) owns the data store. Only one writer is allowed.`
        );
        throw new StartupRefusal();
      }
      logger.warn("db.pg_lease_wait", { owner_host: holder?.host, owner_pid: holder?.pid, heartbeat_at: holder?.heartbeat_at });
      await sleep(2_000);
    }
    this.leaseHeld = true;
    this.leaseConfirmedAt = Date.now();
    // Renew from now on: loading a large store over the network can take longer than the lease (found in the Neon
    // rehearsal: 56k records), and an unrenewed lease would both expire and trip this store's own fencing.
    this.startLeaseHeartbeat(pg);
    const loaded = await pg.load();
    this._data = CommerceDatabase.fromParsed(loaded as Partial<DatabaseSchema>);
    this.persistenceBlocked = null;
    this.blockedCode = null;
    if (this.options.seed !== false) this.ensureDefaultSeed();
    this.startReservationSweeper();
    logger.info("db.pg_ready", {
      tenants: this._data.tenants.length,
      orders: this._data.orders.length,
      customers: this._data.customers.length,
    });
  }

  /** Server: log and exit, as with the JSON lock (FX-24). Tests and scripts: reject ready(). */
  private failStartup(): never {
    if (this.serverMode) {
      this.refuseToStart();
    }
    throw new Error(`The data store can't start (${this.blockedCode}): ${this.persistenceBlocked}`);
  }

  private startLeaseHeartbeat(pg: PgStorePersistence): void {
    if (this.leaseTimer) return; // a retried start-up keeps the one timer
    const renew = async () => {
      if (!this.leaseHeld) return;
      try {
        if (await pg.renewLease()) this.leaseConfirmedAt = Date.now();
        else this.leaseLost();
      } catch (err) {
        // A dropped connection: the next write's fencing check decides; nothing is written without the lease.
        logger.warn("db.pg_lease_renew_failed", { error: (err as Error).message });
      }
    };
    this.leaseTimer = setInterval(() => void renew(), Math.max(1_000, Math.floor(LEASE_TTL_MS / 3)));
    this.leaseTimer.unref();
  }

  /**
   * For mutating requests, before they change anything: 503 when this store can't save right now (Postgres hasn't
   * confirmed the lease, or writing is blocked). No-op for the JSON store and for stores without persistence.
   */
  public assertWritable(): void {
    if (this.backend !== "pg" || !this.persistenceEnabled || this.isTestInstance) return;
    if (this.persistenceBlocked || this.fenced || !this._data || this.leaseStale(LEASE_WRITE_FENCE)) {
      throw new AppError("STORE_UNAVAILABLE", "The database can't be reached, so nothing can be saved right now. Nothing was saved.", 503);
    }
  }

  /** True when the lease hasn't been confirmed for longer than this share of its TTL. */
  private leaseStale(share: number): boolean {
    return this.leaseHeld && this.leaseConfirmedAt > 0 && Date.now() - this.leaseConfirmedAt > LEASE_TTL_MS * share;
  }

  /**
   * Another process owns the store now. A server exits (its memory may be stale: revoked members, changed prices) and
   * is restarted by its supervisor; tests and scripts get 503 for every read and write (security review M1).
   */
  private leaseLost(): void {
    this.leaseHeld = false;
    this.fenced = true;
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.block("LOCK_LOST", "Another process took over the store writer lease; writes stopped.");
    logger.error("db.pg_lease_lost", { unsaved_changes: this.dirty });
    if (this.serverMode) this.refuseToStart();
  }

  private async flushPostgres(): Promise<void> {
    if (this.flushing) await this.flushing;
    const pg = this.pg;
    const data = this._data;
    if (!this.dirty || this.persistenceBlocked || this.isTestInstance || !this.persistenceEnabled || !pg || !data) return;
    this.dirty = false;
    this.flushing = (async () => {
      try {
        const changes = pg.computeChanges(data as unknown as Record<string, unknown>);
        this.reportUnwritable(changes.unwritable, changes.sanitizedRows);
        if (changes.rowCount > 0) {
          const report = await pg.write(changes);
          this.leaseConfirmedAt = Date.now(); // the write's fencing check renewed the lease
          if (pg.hasRetryableRejections()) {
            // Something committed that may unblock a refused row (its parent, say): try those rows once more.
            this.dirty = true;
            if (!this.flushTimer) {
              this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                void this.flush();
              }, this.debounceMs);
            }
          }
          if (report.rejected.length) {
            logger.error("db.pg_rows_not_saved", { rejected: report.rejected.length, written: report.written });
          }
        }
        this.lastPersistError = null;
        this.lastPersistAt = new Date().toISOString();
      } catch (err) {
        this.dirty = true; // retried, never silently dropped
        if (err instanceof LeaseLostError) {
          this.leaseLost();
          return;
        }
        this.lastPersistError = { at: new Date().toISOString(), message: (err as Error).message };
        logger.error("db.persist_failed", { backend: "pg", error: (err as Error).message });
        setTimeout(() => void this.flush(), 1_000).unref();
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
  }

  /** Logged when the numbers change, not on every flush. */
  private reportUnwritable(unwritable: RejectedRow[], sanitized: number): void {
    if (unwritable.length !== this.reportedUnwritable) {
      this.reportedUnwritable = unwritable.length;
      if (unwritable.length) {
        logger.error("db.pg_rows_unwritable", {
          count: unwritable.length,
          sample: unwritable.slice(0, 10).map((r) => ({ collection: r.collection, id: r.id, reason: r.reason })),
        });
      }
    }
    if (sanitized !== this.reportedSanitized) {
      this.reportedSanitized = sanitized;
      if (sanitized) logger.warn("db.pg_rows_sanitized", { count: sanitized });
    }
  }

  private postgresHealth(): PersistenceHealth {
    const unsaved = this.pg ? this.pg.unsavedRows().length : 0;
    const ready = this._data !== null;
    const writerOk = this.leaseHeld || this.isTestInstance || !this.persistenceEnabled;
    return {
      ok: ready && !this.persistenceBlocked && !this.lastPersistError && writerOk && unsaved === 0,
      backend: "pg",
      ready,
      data_dir: this.dataDir,
      dirty: this.dirty,
      last_persist_at: this.lastPersistAt,
      last_persist_error: this.lastPersistError,
      blocked_reason: this.persistenceBlocked,
      blocked_code: this.blockedCode,
      lock: { held: this.leaseHeld, path: "postgres:commerceos.store_writer" },
      debounce_ms: this.debounceMs,
      unsaved_rows: unsaved,
    };
  }

  /** The records that aren't saved as they are in memory (Postgres backend), for logs and tests. */
  public getUnsavedRows(): RejectedRow[] {
    return this.pg ? this.pg.unsavedRows() : [];
  }

  /** Postgres reachable within the timeout (always true for the JSON file). */
  public async pingDatabase(timeoutMs = 2_000): Promise<boolean> {
    const pg = this.pg;
    if (!pg) return true;
    // The readiness probe is unauthenticated: one query at a time, and at most one every 5 s (security review M2).
    if (this.pingCache && Date.now() - this.pingCache.at < 5_000) return this.pingCache.ok;
    this.pingInFlight ??= pg
      .ping(timeoutMs)
      .then((ok) => {
        this.pingCache = { at: Date.now(), ok };
        return ok;
      })
      .finally(() => {
        this.pingInFlight = null;
      });
    return this.pingInFlight;
  }

  /** Flush, then give up the writer lease (Postgres) so the next process doesn't wait for it to expire. */
  public async shutdown(): Promise<void> {
    await this.flush();
    if (this.dirty) logger.error("db.shutdown_with_unsaved_changes", { backend: this.backend, blocked: this.blockedCode });
    const refused = this.getUnsavedRows();
    if (refused.length) {
      logger.error("db.shutdown_with_refused_rows", {
        count: refused.length,
        sample: refused.slice(0, 10).map((r) => ({ collection: r.collection, id: r.id, reason: r.reason })),
        kept_in: "commerceos.refused_rows",
      });
    }
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    if (this.pg && this.leaseHeld) {
      await this.pg.releaseLease().catch(() => undefined);
      this.leaseHeld = false;
    }
  }

  private seedPasswordHashCache: string | null = null;

  /**
   * Password hash for seeded demo accounts (audit C1-b, FX-02). Taken from SEED_ADMIN_PASSWORD (>= 14 chars);
   * without it the accounts are created disabled. Existing accounts are reset with scripts/reset-seed-passwords.ts.
   */
  private seedPasswordHash(): string {
    if (this.seedPasswordHashCache === null) {
      const seedPassword = process.env.SEED_ADMIN_PASSWORD;
      this.seedPasswordHashCache =
        seedPassword && seedPassword.length >= 14 ? bcrypt.hashSync(seedPassword, 12) : DISABLED_PASSWORD_HASH;
    }
    return this.seedPasswordHashCache;
  }

  private ensureDefaultSeed(): void {
    const tenantId = "ten_default_dhaka";
    const userId = "usr_owner_default";

    if (this.data.tenants.length === 0) {
      const defaultTenant: TenantRecord = {
        id: tenantId,
        name: "Dhaka D2C Apparel",
        slug: "dhaka-d2c-apparel",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        language: "en",
        settings: {
          delivery_charge_inside_dhaka: 60,
          delivery_charge_outside_dhaka: 120,
          cod_advance_required: false,
          business_category: "Fashion & Apparel",
          allow_overselling: false,
        },
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const defaultUser: UserRecord = {
        id: userId,
        email: "admin@commerceos.io",
        name: "Rafiqul Islam",
        avatar: "",
        password_hash: this.seedPasswordHash(),
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const defaultMembership: MembershipRecord = {
        id: "mem_default_owner",
        tenant_id: tenantId,
        user_id: userId,
        role: "OWNER",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const defaultAudit: AuditLogRecord = {
        id: "aud_seed_001",
        tenant_id: tenantId,
        actor_user_id: userId,
        action: "TENANT_INITIALIZED",
        resource_type: "tenant",
        resource_id: tenantId,
        metadata: { reason: "Initial workspace seed creation" },
        created_at: new Date().toISOString(),
      };

      this.data.tenants.push(defaultTenant);
      this.data.users.push(defaultUser);
      this.data.memberships.push(defaultMembership);
      this.data.audit_logs.push(defaultAudit);
    }

    // Automatically migrate any legacy tenant-level SUPER_ADMIN memberships to OWNER
    let hasMigrated = false;
    for (const membership of this.data.memberships) {
      if ((membership.role as string) === "SUPER_ADMIN") {
        membership.role = "OWNER";
        hasMigrated = true;
      }
    }

    // Ensure platform users and memberships exist (PLATFORM SCOPE != TENANT SCOPE)
    let saUser = this.data.users.find((u) => u.email === "superadmin@commerceos.io");
    if (!saUser) {
      saUser = {
        id: "usr_superadmin_01",
        email: "superadmin@commerceos.io",
        name: "Platform Super Admin",
        avatar: "",
        password_hash: this.seedPasswordHash(),
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.data.users.push(saUser);
      hasMigrated = true;
    }

    if (!this.data.platform_memberships) {
      this.data.platform_memberships = [];
    }

    if (!this.data.platform_memberships.some((pm) => pm.user_id === saUser!.id)) {
      this.data.platform_memberships.push({
        id: "pm_superadmin_01",
        user_id: saUser.id,
        role: "SUPER_ADMIN",
        mfa_enabled: false, // set only by TOTP enrollment (FX-15)
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      hasMigrated = true;
    }

    // Ensure Super Admin also has a default tenant workspace membership so they can inspect tenant dashboards.
    // Only when that workspace exists: a membership in a missing workspace is refused by Postgres (ADR-108).
    if (
      this.data.tenants.some((t) => t.id === tenantId) &&
      !this.data.memberships.some((m) => m.user_id === saUser!.id && m.tenant_id === tenantId)
    ) {
      this.data.memberships.push({
        id: "mem_superadmin_default",
        tenant_id: tenantId,
        user_id: saUser.id,
        role: "OWNER",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      hasMigrated = true;
    }

    // Seed secondary platform test operators
    const platformStaff = [
      { email: "support@commerceos.io", name: "Platform Support", role: "PLATFORM_SUPPORT" as const },
      { email: "ops@commerceos.io", name: "Platform Operations", role: "PLATFORM_OPERATIONS" as const },
      { email: "analyst@commerceos.io", name: "Platform Analyst", role: "PLATFORM_ANALYST" as const },
      { email: "security@commerceos.io", name: "Platform Security", role: "PLATFORM_SECURITY" as const },
    ];

    for (const staff of platformStaff) {
      let staffUser = this.data.users.find((u) => u.email === staff.email);
      if (!staffUser) {
        staffUser = {
          id: `usr_${staff.role.toLowerCase()}_01`,
          email: staff.email,
          name: staff.name,
          avatar: "",
          password_hash: this.seedPasswordHash(),
          status: "ACTIVE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.users.push(staffUser);
        hasMigrated = true;
      }
      if (!this.data.platform_memberships.some((pm) => pm.user_id === staffUser!.id)) {
        this.data.platform_memberships.push({
          id: `pm_${staff.role.toLowerCase()}_01`,
          user_id: staffUser.id,
          role: staff.role,
          mfa_enabled: false, // set only by TOTP enrollment (FX-15)
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        hasMigrated = true;
      }
    }

    if (hasMigrated) {
      this.persist();
    }

    // Ensure default warehouse exists for the default tenant
    if (this.data.warehouses.length === 0) {
      this.data.warehouses.push({
        id: "wh_dhaka_main",
        tenant_id: tenantId,
        name: "Dhaka Central Fulfillment",
        code: "WH-DHK-01",
        address: "Tejgaon Industrial Area",
        city: "Dhaka",
        district: "Dhaka",
        postal_code: "1208",
        phone: "+8801700000000",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Ensure default category & brand exist
    if (this.data.categories.length === 0) {
      this.data.categories.push({
        id: "cat_apparel",
        tenant_id: tenantId,
        name: "Fashion & Apparel",
        slug: "apparel",
        description: "Clothing, traditional wear, and accessories",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
      });
    }

    if (this.data.brands.length === 0) {
      this.data.brands.push({
        id: "brd_commerceos",
        tenant_id: tenantId,
        name: "CommerceOS Essentials",
        slug: "commerceos-essentials",
        description: "Official demo label",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
      });
    }

    if (this.data.coupons.length === 0) {
      this.data.coupons.push({
        id: "cpn_welcome10",
        tenant_id: tenantId,
        code: "WELCOME10",
        type: "PERCENTAGE",
        value: 10,
        minimum_order_value: 1000,
        maximum_discount: 300,
        usage_limit: 500,
        usage_count: 0,
        status: "ACTIVE",
        created_at: new Date().toISOString(),
      });
    }

    if (this.data.products.filter((p) => p.tenant_id === tenantId).length === 0) {
      this.data.products.push(
        {
          id: "prd_panjabi_01",
          tenant_id: tenantId,
          name: "Premium Royal Oxford Panjabi (Black)",
          slug: "premium-royal-oxford-panjabi-black",
          description: "Premium cotton royal panjabi with handcrafted embroidery and mandarin collar.",
          sku: "PNJ-BLK-XL",
          base_price: 2390,
          currency: "BDT",
          status: "ACTIVE",
          images: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "prd_saree_01",
          tenant_id: tenantId,
          name: "Handloom Muslin Silk Festive Saree",
          slug: "handloom-muslin-silk-festive-saree",
          description: "Traditional Bangladeshi handloom muslin silk saree with intricate zari work.",
          sku: "SAR-MSL-BLU",
          base_price: 3530,
          currency: "BDT",
          status: "ACTIVE",
          images: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "prd_jacket_01",
          tenant_id: tenantId,
          name: "Vintage Washed Denim Jacket (Black)",
          slug: "vintage-washed-denim-jacket-black",
          description: "Heavyweight 12oz washed denim jacket with premium brass buttons.",
          sku: "JKT-DNM-BLK",
          base_price: 2450,
          currency: "BDT",
          status: "ACTIVE",
          images: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );
    }

    if (this.data.product_variants.filter((v) => v.tenant_id === tenantId).length === 0) {
      this.data.product_variants.push(
        {
          id: "var_panjabi_01",
          tenant_id: tenantId,
          product_id: "prd_panjabi_01",
          title: "Premium Royal Oxford Panjabi (Black) - XL",
          sku: "PNJ-BLK-XL",
          price: 2390,
          cost_price: 1100,
          attributes: { size: "XL" },
          status: "ACTIVE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "var_saree_01",
          tenant_id: tenantId,
          product_id: "prd_saree_01",
          title: "Handloom Muslin Silk Festive Saree - Blue",
          sku: "SAR-MSL-BLU",
          price: 3530,
          cost_price: 1600,
          attributes: { color: "Blue" },
          status: "ACTIVE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "var_jacket_01",
          tenant_id: tenantId,
          product_id: "prd_jacket_01",
          title: "Vintage Washed Denim Jacket - Black",
          sku: "JKT-DNM-BLK",
          price: 2450,
          cost_price: 1200,
          attributes: { color: "Black" },
          status: "ACTIVE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );
    }

    if (this.data.inventory_items.filter((i) => i.tenant_id === tenantId).length === 0) {
      this.data.inventory_items.push(
        {
          id: "inv_panjabi_01",
          tenant_id: tenantId,
          warehouse_id: "wh_dhaka_main",
          product_variant_id: "var_panjabi_01",
          quantity_on_hand: 500,
          quantity_reserved: 0,
          quantity_available: 500,
          reorder_point: 20,
          updated_at: new Date().toISOString(),
        },
        {
          id: "inv_saree_01",
          tenant_id: tenantId,
          warehouse_id: "wh_dhaka_main",
          product_variant_id: "var_saree_01",
          quantity_on_hand: 350,
          quantity_reserved: 0,
          quantity_available: 350,
          reorder_point: 15,
          updated_at: new Date().toISOString(),
        },
        {
          id: "inv_jacket_01",
          tenant_id: tenantId,
          warehouse_id: "wh_dhaka_main",
          product_variant_id: "var_jacket_01",
          quantity_on_hand: 400,
          quantity_reserved: 0,
          quantity_available: 400,
          reorder_point: 25,
          updated_at: new Date().toISOString(),
        }
      );
    }

    // Seed default Phase 4 AI policy
    if (this.data.agent_policies.length === 0) {
      this.data.agent_policies.push({
        id: `pol_${tenantId}`,
        tenant_id: tenantId,
        ai_mode: "AI_COPILOT", // Default to Copilot mode for safety
        is_enabled: true,
        autonomous_sales_enabled: false,
        autonomous_support_enabled: false,
        autonomous_order_enabled: false,
        debounce_window_ms: 3000, // 3 seconds window as requested
        confidence_threshold_high: 0.85,
        confidence_threshold_low: 0.60,
        max_iterations_per_run: 5,
        max_tool_calls_per_run: 6,
        max_tokens_per_run: 2000,
        daily_cost_budget_usd: 10.0,
        monthly_cost_budget_usd: 150.0,
        pii_redaction_enabled: true,
        allowed_channel_types: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
        disallowed_tool_names: [],
        human_handoff_reasons: [
          "CUSTOMER_REQUESTED",
          "LOW_CONFIDENCE",
          "PAYMENT_DISPUTE",
          "COMPLAINT",
          "HIGH_RISK_ACTION",
        ],
        updated_at: new Date().toISOString(),
      });
    }

    // Seed 5 initial specialized agents
    if (this.data.agents.length === 0) {
      const initialAgents: AgentDefinition[] = [
        {
          id: "agt_supervisor",
          tenant_id: tenantId,
          agent_type: "SUPERVISOR",
          name: "Supervisor / Agent Router",
          description: "Decomposes customer queries, classifies intent, detects language, and routes to domain agents.",
          status: "ACTIVE",
          model_tier: "TIER_1_FAST",
          model_name: "gemini-1.5-flash",
          prompt_version: "1.0.0",
          allowed_channels: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
          allowed_tools: ["request_human_handoff"],
          max_iterations: 3,
          max_tool_calls: 2,
          timeout_ms: 10000,
          is_default: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "agt_support",
          tenant_id: tenantId,
          agent_type: "CUSTOMER_SUPPORT",
          name: "Customer Support Agent",
          description: "Answers FAQs, store policies, return guidance, delivery charges (৳60/৳120), and handles empathetic inquiries.",
          status: "ACTIVE",
          model_tier: "TIER_1_FAST",
          model_name: "gemini-1.5-flash",
          prompt_version: "1.0.0",
          allowed_channels: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
          allowed_tools: ["search_knowledge", "get_order_status", "get_shipment_status", "get_return_status", "request_human_handoff"],
          max_iterations: 5,
          max_tool_calls: 4,
          timeout_ms: 15000,
          is_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "agt_sales",
          tenant_id: tenantId,
          agent_type: "SALES",
          name: "Sales & Conversion Agent",
          description: "Product recommendation, variant matching, stock verification, wholesale lead capture, and controlled checkout drafts.",
          status: "ACTIVE",
          model_tier: "TIER_2_REASONING",
          model_name: "gemini-1.5-pro",
          prompt_version: "1.0.0",
          allowed_channels: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
          allowed_tools: ["search_products", "get_product", "check_inventory", "create_lead", "create_order_draft", "calculate_checkout", "request_human_handoff"],
          max_iterations: 5,
          max_tool_calls: 6,
          timeout_ms: 20000,
          is_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "agt_order",
          tenant_id: tenantId,
          agent_type: "ORDER_ASSISTANT",
          name: "Order Assistant Agent",
          description: "Order lookup by tracking code, status verification, delivery updates, and controlled cancellation intake.",
          status: "ACTIVE",
          model_tier: "TIER_2_REASONING",
          model_name: "gemini-1.5-pro",
          prompt_version: "1.0.0",
          allowed_channels: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
          allowed_tools: ["get_order", "get_order_status", "get_shipment_status", "get_payment_status", "request_human_handoff"],
          max_iterations: 5,
          max_tool_calls: 5,
          timeout_ms: 15000,
          is_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "agt_product",
          tenant_id: tenantId,
          agent_type: "PRODUCT_INFO",
          name: "Product Information Agent",
          description: "Detailed catalog attribute extraction, sizing chart explanation, care instructions, and inventory availability.",
          status: "ACTIVE",
          model_tier: "TIER_1_FAST",
          model_name: "gemini-1.5-flash",
          prompt_version: "1.0.0",
          allowed_channels: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
          allowed_tools: ["search_products", "get_product", "get_product_variant", "check_inventory", "search_knowledge"],
          max_iterations: 4,
          max_tool_calls: 4,
          timeout_ms: 12000,
          is_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      this.data.agents.push(...initialAgents);
    }

    // Seed Phase 6: Canonical Metric Definitions if empty
    if (this.data.metric_definitions.length === 0) {
      const now = new Date().toISOString();
      this.data.metric_definitions.push(
        {
          id: "metric_sales_revenue",
          key: "sales_revenue",
          name: "Sales Revenue",
          description: "Aggregate gross order revenue across all placed customer transactions.",
          category: "SALES",
          formula: "SUM(orders.grand_total) WHERE orders.status != 'CANCELLED'",
          unit: "CURRENCY",
          currency_sensitive: true,
          aggregation_type: "SUM",
          dimensions: ["channel", "region", "product"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_gross_revenue",
          key: "gross_revenue",
          name: "Gross Revenue",
          description: "Total value of all placed customer orders before discounts, cancellations, or refunds.",
          category: "SALES",
          formula: "SUM(orders.total_amount) WHERE orders.status != 'DRAFT'",
          unit: "CURRENCY",
          currency_sensitive: true,
          aggregation_type: "SUM",
          dimensions: ["channel", "region", "product"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_net_revenue",
          key: "net_revenue",
          name: "Net Revenue",
          description: "Total delivered and paid order value minus returns and approved customer refunds.",
          category: "SALES",
          formula: "SUM(orders.total_amount) WHERE status IN ('DELIVERED', 'COMPLETED') - SUM(refunds.amount)",
          unit: "CURRENCY",
          currency_sensitive: true,
          aggregation_type: "SUM",
          dimensions: ["channel", "region"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_orders_count",
          key: "orders_count",
          name: "Total Orders",
          description: "Total count of valid non-cancelled orders created within the specified period.",
          category: "SALES",
          formula: "COUNT(orders.id) WHERE status != 'CANCELLED'",
          unit: "COUNT",
          currency_sensitive: false,
          aggregation_type: "COUNT",
          dimensions: ["channel", "status"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_aov",
          key: "average_order_value",
          name: "Average Order Value (AOV)",
          description: "Mean order transaction amount across all completed purchases.",
          category: "SALES",
          formula: "net_revenue / orders_count",
          unit: "CURRENCY",
          currency_sensitive: true,
          aggregation_type: "AVERAGE",
          dimensions: ["channel"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_conversion_rate",
          key: "conversion_rate",
          name: "Conversion Rate",
          description: "Percentage of unique customer conversations/inquiries that convert into placed orders.",
          category: "MARKETING",
          formula: "(unique_buying_customers / unique_conversations) * 100",
          unit: "PERCENTAGE",
          currency_sensitive: false,
          aggregation_type: "RATE",
          dimensions: ["channel"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_repeat_rate",
          key: "repeat_customer_rate",
          name: "Repeat Customer Rate",
          description: "Proportion of total purchasers who have placed 2 or more lifetime orders.",
          category: "CUSTOMER",
          formula: "(repeat_customers_count / total_unique_customers) * 100",
          unit: "PERCENTAGE",
          currency_sensitive: false,
          aggregation_type: "RATE",
          dimensions: ["channel", "region"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_return_rate",
          key: "return_rate",
          name: "Return Rate",
          description: "Percentage of delivered or in-transit orders resulting in customer returns.",
          category: "DELIVERY",
          formula: "(returned_orders_count / dispatched_orders_count) * 100",
          unit: "PERCENTAGE",
          currency_sensitive: false,
          aggregation_type: "RATE",
          dimensions: ["courier", "region"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "metric_stockout_rate",
          key: "stockout_rate",
          name: "Stockout Rate",
          description: "Proportion of active catalog SKUs currently possessing zero available inventory.",
          category: "INVENTORY",
          formula: "(zero_stock_sku_count / active_sku_count) * 100",
          unit: "PERCENTAGE",
          currency_sensitive: false,
          aggregation_type: "RATE",
          dimensions: ["warehouse", "category"],
          version: "1.0.0",
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        }
      );
    }

    // Seed Phase 6: Baseline Model Registry
    if (this.data.model_registry.length === 0) {
      const now = new Date().toISOString();
      this.data.model_registry.push(
        {
          id: "mod_demand_forecaster_v1",
          name: "DemandForecaster-HoltWinters",
          version: "1.0.0",
          type: "FORECASTING",
          artifact_uri: "models/forecasting/demand-hw-v1.json",
          feature_version: "v1.2",
          status: "READY",
          metrics: {}, // never evaluated: the seeded MAE/RMSE/precision were made up
          limitations: ["Requires at least 5 historical observations", "Sensitive to sudden promotional shocks"],
          created_at: now,
          updated_at: now,
        },
        {
          id: "mod_sales_forecaster_v1",
          name: "SalesRevenueForecaster-ARIMA",
          version: "1.0.0",
          type: "FORECASTING",
          artifact_uri: "models/forecasting/sales-arima-v1.json",
          feature_version: "v1.1",
          status: "READY",
          metrics: {}, // never evaluated: the seeded MAE/RMSE/precision were made up
          limitations: ["Assumes baseline day-of-week seasonality"],
          created_at: now,
          updated_at: now,
        },
        {
          id: "mod_rfm_segmenter_v1",
          name: "RFM-QuantileSegmenter",
          version: "1.0.0",
          type: "SEGMENTATION",
          artifact_uri: "models/segmentation/rfm-quantile-v1.json",
          feature_version: "v1.0",
          status: "READY",
          metrics: {}, // never evaluated: the seeded MAE/RMSE/precision were made up
          limitations: ["Calibrated for Bangladeshi retail order distributions"],
          created_at: now,
          updated_at: now,
        },
        {
          id: "mod_anomaly_detector_v1",
          name: "ZScoreAnomalyDetector",
          version: "1.0.0",
          type: "ANOMALY_DETECTION",
          artifact_uri: "models/detection/zscore-v1.json",
          feature_version: "v1.0",
          status: "READY",
          metrics: {}, // never evaluated: the seeded MAE/RMSE/precision were made up
          limitations: ["Detects deviations > 2.5 standard deviations from 14-day rolling mean"],
          created_at: now,
          updated_at: now,
        }
      );
    }

    // Phase 7 Baseline Content Templates & Offers
    if (this.data.content_templates.length === 0) {
      const now = new Date().toISOString();
      this.data.content_templates.push(
        {
          id: "tpl_cart_recovery_banglish",
          tenant_id: tenantId,
          name: "WhatsApp Cart Recovery (Banglish)",
          channel: "WHATSAPP",
          language: "banglish",
          category: "CART_RECOVERY",
          body_template: "Salam {{customer_name}} bhai! Apnar cart e {{product_name}} ekhono ache. Coupon code '{{discount_code}}' diye order complete korun ar pete paren special discount!",
          variables_schema: ["customer_name", "product_name", "discount_code"],
          created_at: now,
        },
        {
          id: "tpl_win_back_promo",
          tenant_id: tenantId,
          name: "Dormant Win-Back VIP (Banglish)",
          channel: "WHATSAPP",
          language: "banglish",
          category: "WIN_BACK",
          body_template: "Salam {{customer_name}}! Onek din apnake miss korchi. Apnar pochonder category theke new collection ashche. 15% discount coupon '{{discount_code}}' diye shop korun ekhoni!",
          variables_schema: ["customer_name", "discount_code"],
          created_at: now,
        },
        {
          id: "tpl_cross_sell_delivery",
          tenant_id: tenantId,
          name: "Post-Delivery Cross-Sell (Banglish)",
          channel: "WHATSAPP",
          language: "banglish",
          category: "CROSS_SELL",
          body_template: "Salam {{customer_name}}! Asha kori apnar order poyechen. Apnar {{product_name}} er sathe perfect match korbe erokom items dekhte visit korun: {{cta_url}}",
          variables_schema: ["customer_name", "product_name", "cta_url"],
          created_at: now,
        }
      );
    }

    if (this.data.offers.length === 0) {
      const now = new Date().toISOString();
      const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
      this.data.offers.push(
        {
          id: "off_welcome_10",
          tenant_id: tenantId,
          code: "WELCOME10",
          title: "10% Off New Customer Welcome",
          description: "10% discount for first-time buyers on orders over ৳1,000.",
          type: "PERCENTAGE",
          value: 10,
          rules: {
            min_cart_value_bdt: 1000,
            max_discount_bdt: 500,
            max_usages_per_customer: 1,
            total_usage_limit: 1000,
          },
          starts_at: now,
          expires_at: nextMonth,
          is_active: true,
          current_usage_count: 0,
          created_at: now,
        },
        {
          id: "off_winback_15",
          tenant_id: tenantId,
          code: "COMEBACK15",
          title: "15% Dormant Win-Back Incentive",
          description: "15% off to reactivate customers dormant for 45+ days.",
          type: "PERCENTAGE",
          value: 15,
          rules: {
            min_cart_value_bdt: 1200,
            max_discount_bdt: 750,
            customer_segment: "DORMANT",
            max_usages_per_customer: 1,
          },
          starts_at: now,
          expires_at: nextMonth,
          is_active: true,
          current_usage_count: 0,
          created_at: now,
        }
      );
    }

    // ==================== PHASE 8 SEED: AUTONOMOUS OPERATIONS ====================
    const now = new Date().toISOString();
    if (this.data.suppliers.length === 0) {
      this.data.suppliers.push(
        {
          id: "sup_dhaka_knit_01",
          tenant_id: tenantId,
          name: "Dhaka Knitwear & Fabrics Ltd",
          code: "SUP-DHAKA-KNIT-01",
          contact_person: "Tariqul Islam",
          email: "orders@dhakaknit.com.bd",
          phone: "01712000001",
          address: "Plot 14, Sector 7, Uttara",
          city: "Dhaka",
          lead_time_days: 3,
          payment_terms: "NET_30",
          rating: 4.8,
          is_allowlisted: true,
          min_order_value_bdt: 10000,
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        },
        {
          id: "sup_ctg_denim_02",
          tenant_id: tenantId,
          name: "Chittagong Denim Mills Ltd",
          code: "SUP-CTG-DENIM-02",
          contact_person: "Kamrul Hasan",
          email: "supply@ctgdenim.com.bd",
          phone: "01812000002",
          address: "CEPZ Industrial Area",
          city: "Chittagong",
          lead_time_days: 5,
          payment_terms: "NET_15",
          rating: 4.6,
          is_allowlisted: true,
          min_order_value_bdt: 25000,
          status: "ACTIVE",
          created_at: now,
          updated_at: now,
        }
      );
    }

    if (this.data.supplier_products.length === 0) {
      const var1 = this.data.product_variants[0]?.id || "var_default_01";
      const var2 = this.data.product_variants[1]?.id || "var_default_02";
      this.data.supplier_products.push(
        {
          id: "sp_knit_black_m",
          tenant_id: tenantId,
          supplier_id: "sup_dhaka_knit_01",
          product_variant_id: var1,
          supplier_sku: "DKF-TSHIRT-BLK-M",
          cost_price: 380,
          currency: "BDT",
          moq: 50,
          lead_time_days: 3,
          available_stock: 500,
          is_preferred: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: "sp_ctg_jeans_32",
          tenant_id: tenantId,
          supplier_id: "sup_ctg_denim_02",
          product_variant_id: var2,
          supplier_sku: "CDM-JEANS-SLM-32",
          cost_price: 850,
          currency: "BDT",
          moq: 25,
          lead_time_days: 5,
          available_stock: 200,
          is_preferred: true,
          created_at: now,
          updated_at: now,
        }
      );
    }

    if (this.data.purchase_orders.length === 0) {
      const var1 = this.data.product_variants[0]?.id || "var_default_01";
      this.data.purchase_orders.push({
        id: "po_2026_0001",
        tenant_id: tenantId,
        po_number: "PO-2026-0001",
        supplier_id: "sup_dhaka_knit_01",
        supplier_name: "Dhaka Knitwear & Fabrics Ltd",
        status: "SENT",
        items: [
          {
            id: "poi_01",
            purchase_order_id: "po_2026_0001",
            product_variant_id: var1,
            sku: "TSHIRT-BLK-M",
            product_name: "Classic Crewneck T-Shirt - Black / M",
            quantity_ordered: 100,
            quantity_received: 0,
            unit_cost: 380,
            subtotal: 38000,
          },
        ],
        total_amount: 38000,
        currency: "BDT",
        expected_delivery_date: new Date(Date.now() + 3 * 86400000).toISOString(),
        notes: "Automated replenishment purchase order.",
        approved_by: "SYSTEM_AUTONOMY",
        approved_at: now,
        sent_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    if (this.data.pricing_rules.length === 0) {
      this.data.pricing_rules.push({
        id: "rule_margin_defense_20",
        tenant_id: tenantId,
        name: "Standard Catalog Margin Floor (20%)",
        min_margin_percent: 20,
        max_price_change_percent: 15,
        max_daily_changes: 2,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    }

    // No seeded courier performance (success rates, ratings, costs): measured values in the demo seed (FX-30 follow-up): the demo workspace starts without telemetry, like any new workspace

    // No seeded provider health (bKash/Nagad/Steadfast/Pathao HEALTHY with latencies; none is integrated): measured values in the demo seed (FX-30 follow-up): the demo workspace starts without telemetry, like any new workspace

    if (this.data.sla_policies.length === 0) {
      this.data.sla_policies.push(
        {
          id: "sla_order_fulfill",
          tenant_id: tenantId,
          domain: "ORDER_FULFILLMENT",
          target_duration_minutes: 240,
          warning_threshold_minutes: 180,
          escalation_agent: "FULFILLMENT",
          enabled: true,
          created_at: now,
        },
        {
          id: "sla_shipment_dispatch",
          tenant_id: tenantId,
          domain: "SHIPMENT_DISPATCH",
          target_duration_minutes: 720,
          warning_threshold_minutes: 600,
          escalation_agent: "SHIPPING_OPERATIONS",
          enabled: true,
          created_at: now,
        },
        {
          id: "sla_support_first_response",
          tenant_id: tenantId,
          domain: "SUPPORT_FIRST_RESPONSE",
          target_duration_minutes: 15,
          warning_threshold_minutes: 10,
          escalation_agent: "CUSTOMER_SUPPORT_OPERATIONS",
          enabled: true,
          created_at: now,
        }
      );
    }

    if (this.data.autonomy_budgets.length === 0) {
      this.data.autonomy_budgets.push({
        id: `bud_${tenantId}`,
        tenant_id: tenantId,
        daily_max_actions: 200,
        daily_max_spend_bdt: 150000,
        daily_max_llm_cost_usd: 15.0,
        actions_used_today: 14,
        spend_used_today_bdt: 38000,
        llm_cost_used_today_usd: 1.24,
        is_budget_exhausted: false,
        emergency_stopped: false,
        last_reset_date: now.split("T")[0],
        created_at: now,
        updated_at: now,
      });
    }

    if (this.data.operational_exceptions.length === 0) {
      this.data.operational_exceptions.push({
        id: "exp_transit_delay_01",
        tenant_id: tenantId,
        domain: "SHIPPING",
        exception_type: "TRANSIT_DELAY",
        severity: "MEDIUM",
        status: "DETECTED",
        title: "Shipment TRK-STE-0021 delayed past SLA",
        description: "Steadfast courier parcel in transit for >36 hours between Dhaka hub and Chittagong.",
        entity_type: "SHIPMENT",
        entity_id: "shp_sample_delay_01",
        evidence: {
          tracking_number: "TRK-STE-0021",
          courier: "STEADFAST",
          hours_in_transit: 38,
          threshold_hours: 24,
        },
        root_cause_hypothesis: "Courier hub congestion or highway transit bottleneck.",
        proposed_action: {
          action_type: "NOTIFY_AND_MONITOR",
          description: "Send empathetic Banglish WhatsApp update to customer and escalate courier ticket.",
          risk_level: "LOW",
          parameters: { send_sms: true, courier_ticket: true },
        },
        assigned_agent: "SHIPPING_OPERATIONS",
        created_at: now,
        updated_at: now,
      });
    }

    // ==================== PHASE 10 SEED: AUTONOMOUS COMMERCE PLATFORM ====================
    if (this.data.business_objectives.length === 0) {
      const now = new Date().toISOString();

      // 3 Business Objectives
      this.data.business_objectives.push(
        {
          id: "obj_increase_revenue",
          tenant_id: tenantId,
          organization_id: "org_apex_holding",
          hierarchy_level: "ENTERPRISE",
          name: "Increase Profitable Revenue",
          description: "Grow total revenue by 20% while maintaining minimum 35% gross margin across all brands and stores.",
          status: "ACTIVE",
          target_metric: "revenue_bdt",
          target_value: 12000000,
          current_value: 10000000, // no progress measured yet
          baseline_value: 10000000,
          unit: "BDT",
          time_horizon_start: "2026-01-01T00:00:00Z",
          time_horizon_end: "2026-12-31T23:59:59Z",
          priority: 1,
          risk_tolerance: "MODERATE",
          budget_allocated_bdt: 500000,
          budget_spent_bdt: 0,
          allowed_domains: ["PRICING", "MARKETING", "GROWTH", "INVENTORY"],
          allowed_actions: ["PRICING_ADJUSTMENT", "CAMPAIGN_LAUNCH", "OFFER_CREATION"],
          required_approvals: ["FINANCE_REVIEW"],
          constraints: [
            { type: "MARGIN", name: "Gross Margin Floor", operator: "MIN", value: 35, unit: "percent" },
            { type: "BUDGET", name: "Marketing Spend Cap", operator: "MAX", value: 500000, unit: "BDT" },
          ],
          progress_percent: 0,
          forecast_achievement_percent: null,
          created_by: userId,
          created_at: now,
          updated_at: now,
        },
        {
          id: "obj_reduce_stockouts",
          tenant_id: tenantId,
          organization_id: "org_apex_holding",
          parent_objective_id: "obj_increase_revenue",
          hierarchy_level: "DOMAIN",
          scope_entity_id: "inventory",
          name: "Reduce Stockouts",
          description: "Reduce stockout incidents by 50% through predictive replenishment and cross-store transfers.",
          status: "ACTIVE",
          target_metric: "stockout_rate",
          target_value: 2.5,
          current_value: 5.0, // no progress measured yet
          baseline_value: 5.0,
          unit: "percent",
          time_horizon_start: "2026-01-01T00:00:00Z",
          time_horizon_end: "2026-06-30T23:59:59Z",
          priority: 2,
          risk_tolerance: "CONSERVATIVE",
          budget_allocated_bdt: 100000,
          budget_spent_bdt: 0,
          allowed_domains: ["INVENTORY", "PROCUREMENT"],
          allowed_actions: ["STOCK_TRANSFER", "PURCHASE_ORDER"],
          required_approvals: [],
          constraints: [
            { type: "INVENTORY", name: "Min Safety Stock Days", operator: "MIN", value: 7, unit: "days" },
          ],
          progress_percent: 0,
          forecast_achievement_percent: null,
          created_by: userId,
          created_at: now,
          updated_at: now,
        },
        {
          id: "obj_delivery_success",
          tenant_id: tenantId,
          organization_id: "org_apex_holding",
          hierarchy_level: "DOMAIN",
          scope_entity_id: "fulfillment",
          name: "Improve Delivery Success Rate",
          description: "Achieve 95%+ successful delivery rate by optimizing courier selection and proactive exception handling.",
          status: "ACTIVE",
          target_metric: "delivery_success_rate",
          target_value: 95,
          current_value: 87, // no progress measured yet
          baseline_value: 87,
          unit: "percent",
          time_horizon_start: "2026-01-01T00:00:00Z",
          time_horizon_end: "2026-12-31T23:59:59Z",
          priority: 3,
          risk_tolerance: "MODERATE",
          budget_allocated_bdt: 200000,
          budget_spent_bdt: 0,
          allowed_domains: ["FULFILLMENT", "SHIPPING", "SUPPORT"],
          allowed_actions: ["COURIER_SWITCH", "CUSTOMER_NOTIFICATION", "EXCEPTION_RESOLVE"],
          required_approvals: [],
          constraints: [
            { type: "BUDGET", name: "Courier Cost Cap", operator: "MAX", value: 200000, unit: "BDT" },
          ],
          progress_percent: 0,
          forecast_achievement_percent: null,
          created_by: userId,
          created_at: now,
          updated_at: now,
        }
      );

      // 4 AI Providers
      this.data.ai_providers.push(
        {
          id: "aip_gemini",
          name: "Google Gemini",
          provider_type: "MULTI",
          api_endpoint: "https://generativelanguage.googleapis.com/v1beta",
          supported_models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-embedding-001"],
          capabilities: ["GENERATE", "EMBED", "STREAM", "FUNCTION_CALLING"],
          status: "ACTIVE",
          cost_per_1k_input_tokens: 0.15,
          cost_per_1k_output_tokens: 0.60,
          max_tokens: 1000000,
          rate_limit_rpm: 60,
          regions: ["GLOBAL"],
          data_residency_compliant: true,
          last_health_check_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: "aip_anthropic",
          name: "Anthropic Claude",
          provider_type: "LLM",
          api_endpoint: "https://api.anthropic.com/v1",
          supported_models: ["claude-opus-4", "claude-sonnet-4"],
          capabilities: ["GENERATE", "STREAM", "FUNCTION_CALLING"],
          status: "ACTIVE",
          cost_per_1k_input_tokens: 0.25,
          cost_per_1k_output_tokens: 1.25,
          max_tokens: 200000,
          rate_limit_rpm: 40,
          regions: ["US_EAST", "EU_WEST"],
          data_residency_compliant: true,
          last_health_check_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: "aip_openai",
          name: "OpenAI",
          provider_type: "MULTI",
          api_endpoint: "https://api.openai.com/v1",
          supported_models: ["gpt-4.1", "gpt-4.1-mini", "text-embedding-3-large"],
          capabilities: ["GENERATE", "EMBED", "STREAM", "FUNCTION_CALLING"],
          status: "ACTIVE",
          cost_per_1k_input_tokens: 0.20,
          cost_per_1k_output_tokens: 0.80,
          max_tokens: 128000,
          rate_limit_rpm: 50,
          regions: ["US_EAST", "EU_WEST"],
          data_residency_compliant: true,
          last_health_check_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: "aip_ollama",
          name: "Ollama (Self-Hosted)",
          provider_type: "MULTI",
          api_endpoint: "http://localhost:11434/api",
          supported_models: ["llama3.3", "qwen3", "nomic-embed-text"],
          capabilities: ["GENERATE", "EMBED", "STREAM"],
          status: "ACTIVE",
          cost_per_1k_input_tokens: 0,
          cost_per_1k_output_tokens: 0,
          max_tokens: 128000,
          rate_limit_rpm: 120,
          regions: ["BD"],
          data_residency_compliant: true,
          last_health_check_at: now,
          created_at: now,
          updated_at: now,
        }
      );

      // No seeded platform health (11 dimensions with scores, 99.8% uptime): measured values in the demo seed (FX-30 follow-up): the demo workspace starts without telemetry, like any new workspace

      // No seeded SLOs with made-up current values and error budgets: measured values in the demo seed (FX-30 follow-up): the demo workspace starts without telemetry, like any new workspace
    }

    // Demo webhook rows. Each is reachable at /api/v1/automation/webhooks/<provider>?wh=<id> and must be
    // signed with the HMAC secret held in the env var named by secret_reference (audit C4, ADR-103).
    if (!this.data.automation_webhooks || this.data.automation_webhooks.length === 0) {
      this.data.automation_webhooks = [
        {
          id: "wh_steadfast_default",
          tenant_id: tenantId,
          provider: "STEADFAST",
          endpoint_path: "/api/v1/automation/webhooks/steadfast",
          secret_reference: "STEADFAST_WEBHOOK_SECRET",
          signature_algorithm: "HMAC_SHA256",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "wh_pathao_default",
          tenant_id: tenantId,
          provider: "PATHAO",
          endpoint_path: "/api/v1/automation/webhooks/pathao",
          secret_reference: "PATHAO_WEBHOOK_SECRET",
          signature_algorithm: "HMAC_SHA256",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "wh_bkash_default",
          tenant_id: tenantId,
          provider: "BKASH",
          endpoint_path: "/api/v1/automation/webhooks/bkash",
          secret_reference: "BKASH_WEBHOOK_SECRET",
          signature_algorithm: "HMAC_SHA256",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "wh_nagad_default",
          tenant_id: tenantId,
          provider: "NAGAD",
          endpoint_path: "/api/v1/automation/webhooks/nagad",
          secret_reference: "NAGAD_WEBHOOK_SECRET",
          signature_algorithm: "HMAC_SHA256",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }

    // ==================== SEED: SOCIAL COMMERCE & OMNICHANNEL CHANNELS & CONVERSATIONS ====================
    if (!this.data.connected_channels.some((c) => c.tenant_id === tenantId)) {
      const defaultChannels: ConnectedChannel[] = [
        {
          id: "chn_wa_biz",
          tenant_id: tenantId,
          type: "WHATSAPP",
          name: "WhatsApp Business (+8801711223344)",
          status: "ACTIVE",
          provider_account_id: "wa_phone_dhaka_01",
          credentials_encrypted: "encrypted_wa_token_seed",
          configuration: {
            welcome_message: "Assalamu Alaikum! Welcome to Dhaka Apparel. How can we assist you today?",
            auto_reply_enabled: true,
          },
          created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "chn_meta_fb",
          tenant_id: tenantId,
          type: "FACEBOOK_MESSENGER",
          name: "Dhaka Apparel Official FB Page",
          status: "ACTIVE",
          provider_account_id: "page_fb_dhaka_01",
          credentials_encrypted: "encrypted_fb_token_seed",
          configuration: {
            welcome_message: "Assalamu Alaikum! Thank you for reaching out to Dhaka Apparel on Messenger.",
            auto_reply_enabled: true,
          },
          created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "chn_meta_ig",
          tenant_id: tenantId,
          type: "INSTAGRAM",
          name: "@dhakaapparel.bd (Instagram)",
          status: "ACTIVE",
          provider_account_id: "ig_dhaka_01",
          credentials_encrypted: "encrypted_ig_token_seed",
          configuration: {
            welcome_message: "Hi! Welcome to Dhaka Apparel on Instagram Direct.",
            auto_reply_enabled: true,
          },
          created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "chn_web_chat",
          tenant_id: tenantId,
          type: "WEBSITE_CHAT",
          name: "Storefront Live Chat",
          status: "ACTIVE",
          provider_account_id: "web_chat_dhaka_01",
          credentials_encrypted: "encrypted_web_token_seed",
          configuration: {
            welcome_message: "Welcome! Need help finding your size or delivery details?",
            widget_color: "#C7F900",
            widget_position: "bottom-right",
          },
          created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      this.data.connected_channels.push(...defaultChannels);
    }

    if (!this.data.customers.some((c) => c.tenant_id === tenantId)) {
      const defaultCustomers: Customer[] = [
        {
          id: "cust_nusrat",
          tenant_id: tenantId,
          first_name: "Nusrat",
          last_name: "Jahan",
          email: "nusrat.jahan@gmail.com",
          phone: "+8801711223344",
          status: "ACTIVE",
          source: "SOCIAL",
          notes: "Frequent buyer. Prefers Cash on Delivery inside Dhanmondi.",
          total_orders: 4,
          total_spent: 14500,
          created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cust_tanvir",
          tenant_id: tenantId,
          first_name: "Tanvir",
          last_name: "Ahmed",
          email: "tanvir.ahmed@yahoo.com",
          phone: "+8801819876543",
          status: "ACTIVE",
          source: "SOCIAL",
          notes: "Lives in Chittagong. Ships via Steadfast Courier.",
          total_orders: 1,
          total_spent: 2450,
          created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cust_sadia",
          tenant_id: tenantId,
          first_name: "Sadia",
          last_name: "Islam",
          email: "sadia.islam@outlook.com",
          phone: "+8801912445566",
          status: "ACTIVE",
          source: "SOCIAL",
          notes: "Loyal festive wear customer. Prefers bKash payment.",
          total_orders: 3,
          total_spent: 8900,
          created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cust_kamrul",
          tenant_id: tenantId,
          first_name: "Kamrul",
          last_name: "Hasan",
          email: "kamrul.hasan@gmail.com",
          phone: "+8801712998877",
          status: "ACTIVE",
          source: "SOCIAL",
          notes: "Tejgaon resident. Regular corporate apparel shopper.",
          total_orders: 2,
          total_spent: 6200,
          created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cust_anika",
          tenant_id: tenantId,
          first_name: "Anika",
          last_name: "Rahman",
          email: "anika.rahman@gmail.com",
          phone: "+8801611002233",
          status: "ACTIVE",
          source: "WEBSITE",
          notes: "New prospective shopper from Gulshan.",
          total_orders: 0,
          total_spent: 0,
          created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cust_farhan",
          tenant_id: tenantId,
          first_name: "Farhan",
          last_name: "Kabir",
          email: "farhan.kabir@gmail.com",
          phone: "+8801755667788",
          status: "ACTIVE",
          source: "SOCIAL",
          notes: "Rajshahi customer. Inquiry on Panjabi exchange.",
          total_orders: 2,
          total_spent: 5100,
          created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      this.data.customers.push(...defaultCustomers);
    }

    // Automatically load comprehensive seeded customers if present
    if (this.data.customers.filter((c) => c.tenant_id === tenantId).length <= 6) {
      try {
        const seed10k = path.resolve(process.cwd(), "src/infrastructure/db/seeds/customers-10000.json");
        const seed1k = path.resolve(process.cwd(), "src/infrastructure/db/seeds/customers-1000.json");
        const seedFile = fs.existsSync(seed10k) ? seed10k : fs.existsSync(seed1k) ? seed1k : null;
        if (seedFile) {
          const parsed = JSON.parse(fs.readFileSync(seedFile, "utf-8"));
          if (Array.isArray(parsed.customers)) {
            const existingCustIds = new Set(this.data.customers.map((c) => c.id));
            for (const cust of parsed.customers) {
              if (!existingCustIds.has(cust.id)) {
                this.data.customers.push(cust);
                existingCustIds.add(cust.id);
              }
            }
          }
          if (Array.isArray(parsed.addresses)) {
            const existingAddrIds = new Set(this.data.customer_addresses.map((a) => a.id));
            for (const addr of parsed.addresses) {
              if (!existingAddrIds.has(addr.id)) {
                this.data.customer_addresses.push(addr);
                existingAddrIds.add(addr.id);
              }
            }
          }
        }
      } catch {
        // Continue silently if seed file cannot be loaded
      }
    }

    // Automatically load rich products catalog seed if present
    if (this.data.products.filter((p) => p.tenant_id === tenantId).length <= 3) {
      try {
        const seedPath = path.resolve(process.cwd(), "src/infrastructure/db/seeds/products-catalog.json");
        if (fs.existsSync(seedPath)) {
          const parsed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
          if (Array.isArray(parsed.categories)) {
            const existingCatIds = new Set(this.data.categories.map((c) => c.id));
            for (const cat of parsed.categories) {
              if (!existingCatIds.has(cat.id)) {
                this.data.categories.push(cat);
                existingCatIds.add(cat.id);
              }
            }
          }
          if (Array.isArray(parsed.brands)) {
            const existingBrandIds = new Set(this.data.brands.map((b) => b.id));
            for (const brand of parsed.brands) {
              if (!existingBrandIds.has(brand.id)) {
                this.data.brands.push(brand);
                existingBrandIds.add(brand.id);
              }
            }
          }
          if (Array.isArray(parsed.warehouses)) {
            const existingWhIds = new Set(this.data.warehouses.map((w) => w.id));
            for (const wh of parsed.warehouses) {
              if (!existingWhIds.has(wh.id)) {
                this.data.warehouses.push(wh);
                existingWhIds.add(wh.id);
              }
            }
          }
          if (Array.isArray(parsed.products)) {
            const existingProdIds = new Set(this.data.products.map((p) => p.id));
            for (const prod of parsed.products) {
              if (!existingProdIds.has(prod.id)) {
                this.data.products.push(prod);
                existingProdIds.add(prod.id);
              }
            }
          }
          if (Array.isArray(parsed.productVariants)) {
            const existingVarIds = new Set(this.data.product_variants.map((v) => v.id));
            for (const v of parsed.productVariants) {
              if (!existingVarIds.has(v.id)) {
                this.data.product_variants.push(v);
                existingVarIds.add(v.id);
              }
            }
          }
          if (Array.isArray(parsed.inventoryItems)) {
            const existingInvIds = new Set(this.data.inventory_items.map((i) => i.id));
            for (const inv of parsed.inventoryItems) {
              if (!existingInvIds.has(inv.id)) {
                this.data.inventory_items.push(inv);
                existingInvIds.add(inv.id);
              }
            }
          }
        }
      } catch {
        // Continue silently if seed file cannot be loaded
      }
    }

    if (!this.data.orders.some((o) => o.tenant_id === tenantId)) {
      const sampleOrders: Order[] = [
        {
          id: "ord_demo_01",
          tenant_id: tenantId,
          order_number: "ORD-2024-8921",
          customer_id: "cust_nusrat",
          status: "CONFIRMED",
          currency: "BDT",
          subtotal: 2390,
          discount_total: 0,
          shipping_total: 60,
          tax_total: 0,
          grand_total: 2450,
          payment_method: "BKASH",
          payment_status: "PAID",
          fulfillment_status: "FULFILLED",
          source: "SOCIAL",
          shipping_address_snapshot: {
            phone: "+8801711223344",
            address_line_1: "House 42, Road 9/A, Dhanmondi",
            district: "Dhaka",
            division: "Dhaka",
            country: "Bangladesh",
            postal_code: "1209",
          },
          items: [
            {
              id: "item_ord_01",
              tenant_id: tenantId,
              order_id: "ord_demo_01",
              product_id: "prd_panjabi_01",
              variant_id: "var_panjabi_01",
              product_name_snapshot: "Premium Royal Oxford Panjabi (Black)",
              sku_snapshot: "PNJ-BLK-XL",
              quantity: 1,
              unit_price: 2390,
              discount: 0,
              tax: 0,
              line_total: 2390,
            },
          ],
          created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "ord_demo_02",
          tenant_id: tenantId,
          order_number: "ORD-2024-9120",
          customer_id: "cust_sadia",
          status: "CONFIRMED",
          currency: "BDT",
          subtotal: 3530,
          discount_total: 0,
          shipping_total: 120,
          tax_total: 0,
          grand_total: 3650,
          payment_method: "BKASH",
          payment_status: "PAID",
          fulfillment_status: "UNFULFILLED",
          source: "SOCIAL",
          shipping_address_snapshot: {
            phone: "+8801912445566",
            address_line_1: "Kumarpara, Sylhet Sadar",
            district: "Sylhet",
            division: "Sylhet",
            country: "Bangladesh",
            postal_code: "3100",
          },
          items: [
            {
              id: "item_ord_02",
              tenant_id: tenantId,
              order_id: "ord_demo_02",
              product_id: "prd_saree_01",
              variant_id: "var_saree_01",
              product_name_snapshot: "Handloom Muslin Silk Festive Saree",
              sku_snapshot: "SAR-MSL-BLU",
              quantity: 1,
              unit_price: 3530,
              discount: 0,
              tax: 0,
              line_total: 3530,
            },
          ],
          created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      this.data.orders.push(...sampleOrders);
    }

    // Automatically load comprehensive 5,000 orders seed if present
    if (this.data.orders.filter((o) => o.tenant_id === tenantId).length <= 3) {
      try {
        const seedPath = path.resolve(process.cwd(), "src/infrastructure/db/seeds/orders-5000.json");
        if (fs.existsSync(seedPath)) {
          const parsed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
          if (Array.isArray(parsed.orders)) {
            const existingOrderIds = new Set(this.data.orders.map((o) => o.id));
            for (const order of parsed.orders) {
              if (!existingOrderIds.has(order.id)) {
                this.data.orders.push(order);
                existingOrderIds.add(order.id);
              }
            }
          }
          if (Array.isArray(parsed.orderItems)) {
            const existingItemIds = new Set(this.data.order_items.map((i) => i.id));
            for (const item of parsed.orderItems) {
              if (!existingItemIds.has(item.id)) {
                this.data.order_items.push(item);
                existingItemIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.shipments)) {
            const existingShipIds = new Set(this.data.shipments.map((s) => s.id));
            for (const ship of parsed.shipments) {
              if (!existingShipIds.has(ship.id)) {
                this.data.shipments.push(ship);
                existingShipIds.add(ship.id);
              }
            }
          }
          if (Array.isArray(parsed.payments)) {
            const existingPayIds = new Set(this.data.payments.map((p) => p.id));
            for (const pay of parsed.payments) {
              if (!existingPayIds.has(pay.id)) {
                this.data.payments.push(pay);
                existingPayIds.add(pay.id);
              }
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    if (!this.data.conversations.some((c) => c.tenant_id === tenantId)) {
      const sampleConversations: Conversation[] = [
        {
          id: "conv_seed_01",
          tenant_id: tenantId,
          channel_id: "chn_wa_biz",
          channel_type: "WHATSAPP",
          customer_id: "cust_nusrat",
          external_conversation_id: "wa_user_01711223344",
          status: "OPEN",
          priority: "URGENT",
          mode: "AI",
          automation_paused: false,
          assigned_team_id: "SALES",
          last_message_at: new Date(Date.now() - 2 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 2 * 60000).toISOString(),
          unread_count: 1,
          subject: "Size exchange inquiry for Black Panjabi XL",
          tags: ["SIZE_EXCHANGE", "VIP", "URGENT"],
          source: "WHATSAPP",
          metadata: { intent: "EXCHANGE", source_page: "Catalog" },
          created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 2 * 60000).toISOString(),
        },
        {
          id: "conv_seed_02",
          tenant_id: tenantId,
          channel_id: "chn_meta_fb",
          channel_type: "FACEBOOK_MESSENGER",
          customer_id: "cust_tanvir",
          external_conversation_id: "fb_psid_99210023",
          status: "OPEN",
          priority: "HIGH",
          mode: "AI",
          automation_paused: false,
          assigned_team_id: "SALES",
          last_message_at: new Date(Date.now() - 14 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 14 * 60000).toISOString(),
          unread_count: 0,
          subject: "Chittagong delivery charge & Denim Jacket inquiry",
          tags: ["NEW_ORDER", "HOT_LEAD", "CHITTAGONG"],
          source: "FACEBOOK",
          metadata: { intent: "PURCHASE", ad_campaign: "Eid_Winter_Drop" },
          created_at: new Date(Date.now() - 12 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 14 * 60000).toISOString(),
        },
        {
          id: "conv_seed_03",
          tenant_id: tenantId,
          channel_id: "chn_meta_ig",
          channel_type: "INSTAGRAM",
          customer_id: "cust_sadia",
          external_conversation_id: "ig_user_sadia_islam",
          status: "OPEN",
          priority: "NORMAL",
          mode: "HUMAN",
          automation_paused: true,
          assigned_team_id: "SUPPORT",
          last_message_at: new Date(Date.now() - 45 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 50 * 60000).toISOString(),
          unread_count: 0,
          subject: "Payment verification via bKash TrxID: 9JH7610KL2",
          tags: ["PAYMENT_VERIFIED", "BKASH", "FESTIVE"],
          source: "INSTAGRAM",
          metadata: { intent: "PAYMENT_CONFIRMATION" },
          created_at: new Date(Date.now() - 8 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60000).toISOString(),
        },
        {
          id: "conv_seed_04",
          tenant_id: tenantId,
          channel_id: "chn_web_chat",
          channel_type: "WEBSITE_CHAT",
          customer_id: "cust_anika",
          external_conversation_id: "web_session_9941a8",
          status: "WAITING_AGENT",
          priority: "NORMAL",
          mode: "AI",
          automation_paused: false,
          assigned_team_id: "GENERAL",
          last_message_at: new Date(Date.now() - 90 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 90 * 60000).toISOString(),
          unread_count: 1,
          subject: "Fabric wash care instruction for Oxford cotton shirts",
          tags: ["PRODUCT_CARE", "WEBSITE"],
          source: "WEBSITE",
          metadata: { browser: "Chrome 128", os: "Windows 11" },
          created_at: new Date(Date.now() - 4 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 90 * 60000).toISOString(),
        },
        {
          id: "conv_seed_05",
          tenant_id: tenantId,
          channel_id: "chn_meta_fb",
          channel_type: "FACEBOOK_MESSENGER",
          customer_id: "cust_kamrul",
          external_conversation_id: "fb_psid_33019842",
          status: "RESOLVED",
          priority: "NORMAL",
          mode: "HUMAN",
          automation_paused: false,
          assigned_team_id: "ORDERS",
          last_message_at: new Date(Date.now() - 180 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 190 * 60000).toISOString(),
          unread_count: 0,
          subject: "Corporate order invoice copy request",
          tags: ["INVOICE_SENT", "RESOLVED"],
          source: "FACEBOOK",
          metadata: { resolution_notes: "PDF invoice emailed to customer." },
          created_at: new Date(Date.now() - 48 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 180 * 60000).toISOString(),
        },
        {
          id: "conv_seed_06",
          tenant_id: tenantId,
          channel_id: "chn_wa_biz",
          channel_type: "WHATSAPP",
          customer_id: "cust_farhan",
          external_conversation_id: "wa_user_01755667788",
          status: "OPEN",
          priority: "HIGH",
          mode: "AI",
          automation_paused: false,
          assigned_team_id: "ORDERS",
          last_message_at: new Date(Date.now() - 15 * 60000).toISOString(),
          last_inbound_at: new Date(Date.now() - 15 * 60000).toISOString(),
          unread_count: 0,
          subject: "Pathao courier delivery tracking update",
          tags: ["DELIVERY_TRACKING", "PATHAO"],
          source: "WHATSAPP",
          metadata: { tracking_number: "PT-771920" },
          created_at: new Date(Date.now() - 36 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 15 * 60000).toISOString(),
        },
      ];
      this.data.conversations.push(...sampleConversations);

      const sampleMessages: Message[] = [
        // Conversation 1: Nusrat Jahan
        {
          id: "msg_s01_01",
          tenant_id: tenantId,
          conversation_id: "conv_seed_01",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_nusrat",
          message_type: "TEXT",
          text: "Assalamu Alaikum, ami Premium Oxford Panjabi M size niyechi, kintu L size lagbe. Exchange process ta bolben please?",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 10 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 10 * 60000).toISOString(),
        },
        {
          id: "msg_s01_02",
          tenant_id: tenantId,
          conversation_id: "conv_seed_01",
          direction: "OUTBOUND",
          sender_type: "BOT",
          message_type: "TEXT",
          text: "Walaikum Assalam Nusrat apu! Order #ORD-2024-8921 er jonno amader 7-day hassle-free exchange policy ache. Amader delivery rider new size deliver korar somoy ager Panjabi-ti collect kore nibe. Apnar delivery address ki Dhanmondi-i thakbe?",
          status: "DELIVERED",
          retry_count: 0,
          metadata: { is_ai: true, model: "gemini-1.5-flash", confidence: 0.94, policy_citation: "7-Day Exchange Policy" },
          created_at: new Date(Date.now() - 8 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 8 * 60000).toISOString(),
        },
        {
          id: "msg_s01_03",
          tenant_id: tenantId,
          conversation_id: "conv_seed_01",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_nusrat",
          message_type: "TEXT",
          text: "Ji, Dhanmondi Road 9/A tei thakbe. Delivery charge koto hobe exchange er jonno?",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 5 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 5 * 60000).toISOString(),
        },
        {
          id: "msg_s01_04",
          tenant_id: tenantId,
          conversation_id: "conv_seed_01",
          direction: "OUTBOUND",
          sender_type: "AGENT",
          sender_id: "usr_owner_default",
          message_type: "TEXT",
          text: "Dhaka city er moddhe exchange charge only ৳60 apu। Ami exchange order confirm kore diyechi, kal dupurer moddhe rider pouchhe jabe।",
          status: "DELIVERED",
          retry_count: 0,
          metadata: { author_name: "Rafiqul Islam" },
          created_at: new Date(Date.now() - 2 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 2 * 60000).toISOString(),
        },

        // Conversation 2: Tanvir Ahmed
        {
          id: "msg_s02_01",
          tenant_id: tenantId,
          conversation_id: "conv_seed_02",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_tanvir",
          message_type: "TEXT",
          text: "Bhai Denim Jacket ta ki stock e ache? Chittagong e deliver korte koto din lagbe?",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 30 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
          id: "msg_s02_02",
          tenant_id: tenantId,
          conversation_id: "conv_seed_02",
          direction: "OUTBOUND",
          sender_type: "BOT",
          message_type: "TEXT",
          text: "Hello Tanvir bhai! Ji, Vintage Denim Jacket (Black, XL) stock e ache — current price ৳2,450. Chittagong e Steadfast Courier diye 48-72 hours er moddhe Cash on Delivery te receive korte parben. Delivery charge ৳120.",
          status: "DELIVERED",
          retry_count: 0,
          metadata: { is_ai: true, model: "gemini-1.5-flash", confidence: 0.96 },
          created_at: new Date(Date.now() - 28 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 28 * 60000).toISOString(),
        },
        {
          id: "msg_s02_03",
          tenant_id: tenantId,
          conversation_id: "conv_seed_02",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_tanvir",
          message_type: "TEXT",
          text: "Ami bKash advance dite chai. Kono Eid discount code ache?",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 14 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 14 * 60000).toISOString(),
        },

        // Conversation 3: Sadia Islam
        {
          id: "msg_s03_01",
          tenant_id: tenantId,
          conversation_id: "conv_seed_03",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_sadia",
          message_type: "TEXT",
          text: "Hi! Ami Muslin Silk Saree er jonno bKash korechi ৳3,650. TrxID: 9JH7610KL2.",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 60 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 60 * 60000).toISOString(),
        },
        {
          id: "msg_s03_02",
          tenant_id: tenantId,
          conversation_id: "conv_seed_03",
          direction: "OUTBOUND",
          sender_type: "SYSTEM",
          message_type: "INTERNAL_NOTE",
          text: "🔒 bKash Statement match verified: ৳3,650 received from +8801912445566, TrxID: 9JH7610KL2. Order ready to pack.",
          status: "SENT",
          retry_count: 0,
          metadata: { author_name: "Automated Ledger Bot" },
          created_at: new Date(Date.now() - 55 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 55 * 60000).toISOString(),
        },
        {
          id: "msg_s03_03",
          tenant_id: tenantId,
          conversation_id: "conv_seed_03",
          direction: "OUTBOUND",
          sender_type: "AGENT",
          sender_id: "usr_owner_default",
          message_type: "TEXT",
          text: "Thank you Sadia apu! Apnar bKash payment verify hoyeche. Order #ORD-2024-9120 packaging shuru hoyeche. Pathao courier tracking number PT-771920 peye jaben SMS er maddhome.",
          status: "DELIVERED",
          retry_count: 0,
          metadata: { author_name: "Rafiqul Islam" },
          created_at: new Date(Date.now() - 45 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60000).toISOString(),
        },

        // Conversation 4: Anika Rahman
        {
          id: "msg_s04_01",
          tenant_id: tenantId,
          conversation_id: "conv_seed_04",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_anika",
          message_type: "TEXT",
          text: "Hello, Cotton casual shirts gulo ki machine wash kora jabe naki dry wash korte hobe?",
          status: "RECEIVED",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 90 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 90 * 60000).toISOString(),
        },

        // Conversation 6: Farhan Kabir
        {
          id: "msg_s06_01",
          tenant_id: tenantId,
          conversation_id: "conv_seed_06",
          direction: "INBOUND",
          sender_type: "CUSTOMER",
          sender_id: "cust_farhan",
          message_type: "TEXT",
          text: "Amar parcel ta Rajshahi te kobe delivery hobe? Pathao rider ki call dibe?",
          status: "READ",
          retry_count: 0,
          metadata: {},
          created_at: new Date(Date.now() - 25 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 25 * 60000).toISOString(),
        },
        {
          id: "msg_s06_02",
          tenant_id: tenantId,
          conversation_id: "conv_seed_06",
          direction: "OUTBOUND",
          sender_type: "BOT",
          message_type: "TEXT",
          text: "Hello Farhan bhai! Tracking number PT-771920 onujayi parcel ti currently Rajshahi Central Hub e reach koreche. Ajke dupur 2tar moddhe Pathao delivery hero apnake call kore parcel deliver korbe.",
          status: "DELIVERED",
          retry_count: 0,
          metadata: { is_ai: true, model: "gemini-1.5-flash", confidence: 0.97 },
          created_at: new Date(Date.now() - 15 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 15 * 60000).toISOString(),
        },
      ];
      this.data.messages.push(...sampleMessages);
    }

    if (!this.data.quick_replies.some((q) => q.tenant_id === tenantId)) {
      const defaultQuickReplies: QuickReply[] = [
        {
          id: "qr_deliv_charges",
          tenant_id: tenantId,
          title: "ডেলিভারি চার্জ (ঢাকা ও ঢাকার বাইরে)",
          content: "আমাদের ডেলিভারি চার্জ ঢাকা সিটির ভেতরে মাত্র ৳৬০ এবং ঢাকার বাইরে সারা বাংলাদেশে ৳১২০। ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।",
          category: "Shipping",
          active: true,
          shortcut: "/delivery",
          created_at: new Date().toISOString(),
        },
        {
          id: "qr_exchange_policy",
          tenant_id: tenantId,
          title: "৭ দিনের এক্সচেঞ্জ পলিসি",
          content: "আমাদের যেকোনো প্রডাক্টে সাইজ বা ফিটিং সমস্যা থাকলে রিসিভ করার ৭ দিনের মধ্যে সম্পূর্ণ ঝামেলামুক্তভাবে এক্সচেঞ্জ করার সুবিধা পাবেন।",
          category: "Returns",
          active: true,
          shortcut: "/exchange",
          created_at: new Date().toISOString(),
        },
        {
          id: "qr_bkash_merchant",
          tenant_id: tenantId,
          title: "বিকাশ পেমেন্ট তথ্য",
          content: "আমাদের বিকাশ মার্চেন্ট নাম্বার: 01711223344। bKash App থেকে 'Make Payment' অপশন সিলেক্ট করে রেফারেন্সে আপনার মোবাইল নাম্বার দিন।",
          category: "Payment",
          active: true,
          shortcut: "/bkash",
          created_at: new Date().toISOString(),
        },
        {
          id: "qr_panjabi_sizes",
          tenant_id: tenantId,
          title: "পাঞ্জাবি সাইজ গাইড",
          content: "পাঞ্জাবি সাইজ চার্ট: M (Chest 38, Length 40), L (Chest 40, Length 42), XL (Chest 42, Length 44), XXL (Chest 44, Length 46)।",
          category: "Sales",
          active: true,
          shortcut: "/sizes",
          created_at: new Date().toISOString(),
        },
      ];
      this.data.quick_replies.push(...defaultQuickReplies);
    }

    // Seed default Abandoned Carts for Phase 8 Marketing Module
    if (this.data.abandoned_carts.length === 0) {
      this.data.abandoned_carts.push(
        {
          id: "acr_seed_01",
          tenant_id: tenantId,
          customer_id: "cust_nusrat",
          cart_items: [
            {
              product_id: "prd_saree_01",
              title: "Handloom Muslin Silk Festive Saree",
              price: 3530,
              quantity: 1,
            },
          ],
          abandoned_total_bdt: 3530,
          abandoned_at: new Date(Date.now() - 4 * 3600000).toISOString(),
          recovery_stage: "PENDING",
        },
        {
          id: "acr_seed_02",
          tenant_id: tenantId,
          customer_id: "cust_tanvir",
          cart_items: [
            {
              product_id: "prd_panjabi_01",
              title: "Premium Royal Oxford Panjabi (Black)",
              price: 2390,
              quantity: 1,
            },
          ],
          abandoned_total_bdt: 2390,
          abandoned_at: new Date(Date.now() - 18 * 3600000).toISOString(),
          recovery_stage: "MESSAGED",
        },
        {
          id: "acr_seed_03",
          tenant_id: tenantId,
          customer_id: "cust_farhan",
          cart_items: [
            {
              product_id: "prd_jacket_01",
              title: "Vintage Washed Denim Jacket (Black)",
              price: 2450,
              quantity: 2,
            },
          ],
          abandoned_total_bdt: 4900,
          abandoned_at: new Date(Date.now() - 48 * 3600000).toISOString(),
          recovery_stage: "RECOVERED",
          recovered_order_id: "ord_demo_01",
        }
      );
    }

    // Seed default Audiences / Cohorts
    if (this.data.audiences.length === 0) {
      this.data.audiences.push(
        {
          id: "aud_seed_vip",
          tenant_id: tenantId,
          name: "VIP High LTV Customers",
          description: "High-value customers with total spend >= ৳10,000 or 3+ orders",
          type: "DYNAMIC",
          status: "ACTIVE",
          rule_groups: [
            {
              conjunction: "OR",
              conditions: [
                { field: "total_spend", operator: "GREATER_THAN_OR_EQUAL", value: 10000 },
                { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 3 },
              ],
            },
          ],
          estimated_size: 42,
          last_evaluated_at: new Date().toISOString(),
          created_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "aud_seed_dormant_60d",
          tenant_id: tenantId,
          name: "Dormant Customers (60D+)",
          description: "Past buyers with no purchases within the last 60 days",
          type: "DYNAMIC",
          status: "ACTIVE",
          rule_groups: [
            {
              conjunction: "AND",
              conditions: [
                { field: "last_purchase_days_ago", operator: "GREATER_THAN_OR_EQUAL", value: 60 },
              ],
            },
          ],
          estimated_size: 86,
          last_evaluated_at: new Date().toISOString(),
          created_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "aud_seed_cart_abandoners",
          tenant_id: tenantId,
          name: "Cart Abandoners (24H - 7D)",
          description: "Sessions with unrecovered abandoned carts and purchase intent",
          type: "BEHAVIORAL",
          status: "ACTIVE",
          rule_groups: [
            {
              conjunction: "AND",
              conditions: [
                { field: "has_abandoned_cart", operator: "EQUALS", value: true },
              ],
            },
          ],
          estimated_size: 29,
          last_evaluated_at: new Date().toISOString(),
          created_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "aud_seed_repeat_champions",
          tenant_id: tenantId,
          name: "Repeat Champions",
          description: "Loyal repeat buyers with 2+ completed orders and 0 return issues",
          type: "LIFECYCLE",
          status: "ACTIVE",
          rule_groups: [
            {
              conjunction: "AND",
              conditions: [
                { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 2 },
              ],
            },
          ],
          estimated_size: 64,
          last_evaluated_at: new Date().toISOString(),
          created_by: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );
    }

    // Seed default Campaigns
    if (this.data.campaigns.length === 0) {
      this.data.campaigns.push(
        {
          id: "cmp_seed_01",
          tenant_id: tenantId,
          name: "Eid Winter Drop VIP Exclusive",
          objective: "CONVERSION",
          status: "REVIEW",
          audience_id: "aud_seed_vip",
          channel: "WHATSAPP",
          variants: [
            {
              id: "var_01",
              name: "VIP Early Access",
              subject_or_title: "Exclusive Early Access",
              content_body: "Assalamu Alaikum {customer_name}! Apnar jonno CommerceOS Winter Collection ekhon live. Shop early before stock runs out: https://commerceos.io/vip. Reply STOP to unsubscribe",
              call_to_action: "Shop Now",
              allocation_pct: 100,
            },
          ],
          budget_bdt: 12500,
          action_risk_level: "HIGH" as any,
          required_approval: true,
          risk_class: "HIGH",
          simulation_snapshot: {
            simulated_at: new Date().toISOString(),
            estimated_reach: 240,
            expected_conversion_rate: 8.5,
            expected_orders: 20,
            expected_revenue_bdt: 49000,
            expected_cost_bdt: 12800,
            expected_margin_delta_pct: null,
            assumptions: ["Sample data seeded for the demo workspace."],
            simulated_label: "SIMULATED",
          },
          created_by: userId,
          created_at: new Date(Date.now() - 3600000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cmp_seed_02",
          tenant_id: tenantId,
          name: "Dormant Win-Back 15% OFF",
          objective: "REACTIVATION",
          status: "COMPLETED",
          audience_id: "aud_seed_dormant_60d",
          channel: "WHATSAPP",
          variants: [
            {
              id: "var_02",
              name: "Win-Back 15",
              subject_or_title: "We miss you!",
              content_body: "Assalamu Alaikum {customer_name}! Amra apnake miss korchi. 'COMEBACK15' code bebohar kore paben 15% discount: https://commerceos.io/shop. Reply STOP to unsubscribe",
              call_to_action: "Claim 15% OFF",
              allocation_pct: 100,
            },
          ],
          budget_bdt: 4500,
          action_risk_level: "MEDIUM" as any,
          required_approval: false,
          risk_class: "MEDIUM",
          result_metrics: {
            planned_audience: 86,
            actual_audience: 86,
            messages_sent: 86,
            messages_delivered: 84,
            messages_failed: 2,
            messages_suppressed: 0,
            // Outcomes come from recorded attributions, never assumed rates (FX-30)
            engagements: null,
            conversions: null,
            attributed_revenue_bdt: null,
            incremental_revenue_bdt: null,
            total_cost_bdt: 4500,
            roas: null,
            attribution_status: "NOT_MEASURED",
            evaluated_at: new Date(Date.now() - 86400000).toISOString(),
          },
          created_by: userId,
          created_at: new Date(Date.now() - 172800000).toISOString(),
          updated_at: new Date().toISOString(),
        }
      );
    }

    // Seed default Campaign Attribution
    if (this.data.campaign_attributions.length === 0) {
      this.data.campaign_attributions.push({
        id: "att_seed_01",
        tenant_id: tenantId,
        order_id: "ord_demo_01",
        customer_id: "cust_farhan",
        order_total_bdt: 2450,
        attribution_model: "LAST_TOUCH",
        touchpoints: [
          {
            touch_id: "touch_seed_01",
            campaign_id: "cmp_seed_02",
            channel: "WHATSAPP",
            touched_at: new Date(Date.now() - 90000000).toISOString(),
            weight: 1,
          },
        ],
        campaign_credits: {
          cmp_seed_02: {
            attributed_revenue_bdt: 2450,
            share_pct: 100,
          },
        },
        incremental_revenue_estimated_bdt: null, // needs a control group (FX-30)
        created_at: new Date(Date.now() - 86400000).toISOString(),
      });
    }

    // Automatically load comprehensive Growth Command Center intelligence seed if present
    if (this.data.customer_lifecycles.filter((l) => l.tenant_id === tenantId).length <= 1) {
      try {
        const growthSeedPath = path.resolve(process.cwd(), "src/infrastructure/db/seeds/growth-data.json");
        if (fs.existsSync(growthSeedPath)) {
          const parsed = JSON.parse(fs.readFileSync(growthSeedPath, "utf-8"));
          if (Array.isArray(parsed.customer_lifecycles)) {
            const existingLifeIds = new Set(this.data.customer_lifecycles.map((l) => l.customer_id));
            for (const item of parsed.customer_lifecycles) {
              if (!existingLifeIds.has(item.customer_id)) {
                this.data.customer_lifecycles.push(item);
                existingLifeIds.add(item.customer_id);
              }
            }
          }
          if (Array.isArray(parsed.customer_lifecycle_transitions)) {
            const existingTransIds = new Set(this.data.customer_lifecycle_transitions.map((t) => t.id));
            for (const item of parsed.customer_lifecycle_transitions) {
              if (!existingTransIds.has(item.id)) {
                this.data.customer_lifecycle_transitions.push(item);
                existingTransIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.audiences)) {
            const existingAudIds = new Set(this.data.audiences.map((a) => a.id));
            for (const item of parsed.audiences) {
              if (!existingAudIds.has(item.id)) {
                this.data.audiences.push(item);
                existingAudIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.audience_members)) {
            const existingMemIds = new Set(this.data.audience_members.map((m) => m.id));
            for (const item of parsed.audience_members) {
              if (!existingMemIds.has(item.id)) {
                this.data.audience_members.push(item);
                existingMemIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.campaigns)) {
            const existingCmpIds = new Set(this.data.campaigns.map((c) => c.id));
            for (const item of parsed.campaigns) {
              if (!existingCmpIds.has(item.id)) {
                this.data.campaigns.push(item);
                existingCmpIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.campaign_attributions)) {
            const existingAttIds = new Set(this.data.campaign_attributions.map((a) => a.id));
            for (const item of parsed.campaign_attributions) {
              if (!existingAttIds.has(item.id)) {
                this.data.campaign_attributions.push(item);
                existingAttIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.journeys)) {
            const existingJrnIds = new Set(this.data.journeys.map((j) => j.id));
            for (const item of parsed.journeys) {
              if (!existingJrnIds.has(item.id)) {
                this.data.journeys.push(item);
                existingJrnIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.journey_enrollments)) {
            const existingEnrIds = new Set(this.data.journey_enrollments.map((e) => e.id));
            for (const item of parsed.journey_enrollments) {
              if (!existingEnrIds.has(item.id)) {
                this.data.journey_enrollments.push(item);
                existingEnrIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.growth_insights)) {
            const existingInsIds = new Set(this.data.growth_insights.map((i) => i.id));
            for (const item of parsed.growth_insights) {
              if (!existingInsIds.has(item.id)) {
                this.data.growth_insights.push(item);
                existingInsIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.growth_recommendations)) {
            const existingRecIds = new Set(this.data.growth_recommendations.map((r) => r.id));
            for (const item of parsed.growth_recommendations) {
              if (!existingRecIds.has(item.id)) {
                this.data.growth_recommendations.push(item);
                existingRecIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.experiments)) {
            const existingExpIds = new Set(this.data.experiments.map((e) => e.id));
            for (const item of parsed.experiments) {
              if (!existingExpIds.has(item.id)) {
                this.data.experiments.push(item);
                existingExpIds.add(item.id);
              }
            }
          }
          if (Array.isArray(parsed.offers)) {
            const existingOffIds = new Set(this.data.offers.map((o) => o.id));
            for (const item of parsed.offers) {
              if (!existingOffIds.has(item.id)) {
                this.data.offers.push(item);
                existingOffIds.add(item.id);
              }
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    // Seed default Executive Business Digests for Phase 7 Analytics Module
    if (this.data.executive_digests.length === 0) {
      this.data.executive_digests.push(
        {
          id: "ed_seed_daily_01",
          tenant_id: tenantId,
          period_type: "DAILY",
          period_start: new Date(Date.now() - 86400000).toISOString(),
          period_end: new Date().toISOString(),
          title: "Executive Daily Briefing • Commercial Health",
          executive_summary: "Robust omnichannel sales velocity observed across WhatsApp and F-Commerce channels with total daily GMV reaching ৳48,500. AOV settled at ৳2,210 with a healthy 61.4% Gross Margin. Nationwide RTO averaged 5.2%, though Cox's Bazar and Sunamganj exhibited elevated delivery refusal rates (18.2%).",
          financial_summary: {
            gmv_bdt: 48500,
            aov_bdt: 2210,
            gross_margin_pct: 61.4,
            orders_count: 22,
            rto_rate_pct: 5.2,
          },
          channel_highlights: [
            {
              channel: "WHATSAPP",
              gmv_bdt: 26800,
              share_pct: 55.3,
              highlight: "Top grossing channel driven by conversational checkout & cart nudges (18.4% conv)",
            },
            {
              channel: "FACEBOOK_MESSENGER",
              gmv_bdt: 14200,
              share_pct: 29.3,
              highlight: "High inquiry volume on Winter Panjabi collection",
            },
            {
              channel: "WEBSITE",
              gmv_bdt: 7500,
              share_pct: 15.4,
              highlight: "Self-service web cart checkouts with 100% prepaid rate",
            },
          ],
          rto_hotspots: [
            {
              district: "Cox's Bazar",
              division: "Chattogram",
              rto_pct: 18.2,
              risk_tier: "HIGH_RISK",
            },
            {
              district: "Sunamganj",
              division: "Sylhet",
              rto_pct: 16.7,
              risk_tier: "HIGH_RISK",
            },
          ],
          strategic_recommendations: [
            "Enforce mandatory partial bKash delivery advance (150 BDT) for Cox's Bazar and Sunamganj to curb doorstep refusals.",
            "Handloom Muslin Saree inventory running low (8 units remaining). Prioritize supplier restock to prevent margin loss.",
            "Scale WhatsApp broadcast volume within 20 msgs/sec provider limit to sustain AOV lift.",
          ],
          generated_by_agent: "ANALYTICS_AGENT",
          created_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: "ed_seed_weekly_01",
          tenant_id: tenantId,
          period_type: "WEEKLY",
          period_start: new Date(Date.now() - 7 * 86400000).toISOString(),
          period_end: new Date().toISOString(),
          title: "Executive Weekly Commercial Digest • Week 38",
          executive_summary: "Weekly revenue reached ৳312,000 across 143 confirmed transactions. Gross profit exceeded ৳193,700 representing a 62.1% blended margin. Delivery success rate reached 94.2% with Steadfast achieving a 34-hour average delivery turnaround inside Dhaka.",
          financial_summary: {
            gmv_bdt: 312000,
            aov_bdt: 2180,
            gross_margin_pct: 62.1,
            orders_count: 143,
            rto_rate_pct: 5.8,
          },
          channel_highlights: [
            {
              channel: "WHATSAPP",
              gmv_bdt: 172000,
              share_pct: 55.1,
              highlight: "Primary driver of repeat VIP customer transactions",
            },
            {
              channel: "FACEBOOK_MESSENGER",
              gmv_bdt: 95000,
              share_pct: 30.4,
              highlight: "Strong acquisition of first-time buyers via comments",
            },
            {
              channel: "WEBSITE",
              gmv_bdt: 45000,
              share_pct: 14.5,
              highlight: "Direct organic traffic steady",
            },
          ],
          rto_hotspots: [
            {
              district: "Cox's Bazar",
              division: "Chattogram",
              rto_pct: 17.5,
              risk_tier: "HIGH_RISK",
            },
          ],
          strategic_recommendations: [
            "Maintain current Pathao/Steadfast SLA allocation inside Dhaka Metro.",
            "Expand conversational checkout prompts to Instagram DMs where conversion rate is trending upwards.",
          ],
          generated_by_agent: "ANALYTICS_AGENT",
          created_at: new Date(Date.now() - 86400000).toISOString(),
        }
      );
    }

    // Seed Phase 12: Canonical SaaS Plans and Plan Versions
    if (!this.data.plans || this.data.plans.length === 0) {
      const now = new Date().toISOString();
      const canonicalPlans: PlanRecord[] = [
        { id: "FREE", name: "Free Tier", description: "Bootstrap tier for new social sellers", is_active: true, created_at: now, updated_at: now },
        { id: "STARTER", name: "Starter", description: "Growing single-brand stores with order automation", is_active: true, created_at: now, updated_at: now },
        { id: "GROWTH", name: "Growth", description: "Omnichannel brand scaling with n8n workflow automations", is_active: true, created_at: now, updated_at: now },
        { id: "PRO", name: "Pro", description: "High-volume D2C operations with AI agents and dedicated workers", is_active: true, created_at: now, updated_at: now },
        { id: "ENTERPRISE", name: "Enterprise", description: "Custom multi-warehouse multi-channel retail infrastructure with dedicated SLA", is_active: true, created_at: now, updated_at: now },
      ];
      this.data.plans = canonicalPlans;

      const planVersions: PlanVersionRecord[] = [
        { id: "pv_free_v1", plan_id: "FREE", version: 1, billing_period: "MONTHLY", price_bdt: 0, is_published: true, features: { max_users: 2, max_orders: 100, automations: false }, created_at: now },
        { id: "pv_starter_v1", plan_id: "STARTER", version: 1, billing_period: "MONTHLY", price_bdt: 1999, is_published: true, features: { max_users: 5, max_orders: 500, automations: true }, created_at: now },
        { id: "pv_growth_v1", plan_id: "GROWTH", version: 1, billing_period: "MONTHLY", price_bdt: 4999, is_published: true, features: { max_users: 15, max_orders: 2500, automations: true }, created_at: now },
        { id: "pv_pro_v1", plan_id: "PRO", version: 1, billing_period: "MONTHLY", price_bdt: 9999, is_published: true, features: { max_users: 50, max_orders: 10000, automations: true }, created_at: now },
        { id: "pv_enterprise_v1", plan_id: "ENTERPRISE", version: 1, billing_period: "MONTHLY", price_bdt: 24999, is_published: true, features: { max_users: 500, max_orders: 100000, automations: true }, created_at: now },
      ];
      this.data.plan_versions = planVersions;
    }

    // Seed Phase 12: Canonical Entitlements
    if (!this.data.entitlements || this.data.entitlements.length === 0) {
      const now = new Date().toISOString();
      const canonicalEntitlements: EntitlementRecord[] = [
        { id: "max_users", name: "Max Staff Users", value_type: "NUMERIC", default_value: 5, created_at: now },
        { id: "max_products", name: "Max Catalog Products", value_type: "NUMERIC", default_value: 500, created_at: now },
        { id: "max_orders_per_month", name: "Monthly Order Quota", value_type: "NUMERIC", default_value: 1000, created_at: now },
        { id: "max_automations", name: "Active Automations Limit", value_type: "NUMERIC", default_value: 10, created_at: now },
        { id: "max_n8n_executions", name: "Monthly n8n Executions", value_type: "NUMERIC", default_value: 5000, created_at: now },
        { id: "max_channels", name: "Connected Channels", value_type: "NUMERIC", default_value: 3, created_at: now },
        { id: "max_storage_gb", name: "Storage Allowance (GB)", value_type: "NUMERIC", default_value: 10, created_at: now },
        { id: "automation.n8n", name: "n8n Workflow Engine Access", value_type: "BOOLEAN", default_value: true, created_at: now },
        { id: "ai.agentic_workflows", name: "Autonomous AI Agents Access", value_type: "BOOLEAN", default_value: true, created_at: now },
        { id: "support.priority", name: "Dedicated 24/7 SLA Support", value_type: "BOOLEAN", default_value: false, created_at: now },
      ];
      this.data.entitlements = canonicalEntitlements;
    }

    // Seed Phase 12: Default Tenant Subscription
    if (!this.data.subscriptions || this.data.subscriptions.length === 0) {
      const now = new Date().toISOString();
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      this.data.subscriptions = [
        {
          id: "sub_dhaka_001",
          tenant_id: tenantId,
          plan_id: "GROWTH",
          plan_version_id: "pv_growth_v1",
          status: "ACTIVE",
          current_period_start: now,
          current_period_end: nextMonth,
          cancel_at_period_end: false,
          created_at: now,
          updated_at: now,
        },
      ];
    }

    // Seed Phase 12: Default n8n Instance if missing
    if (!this.data.n8n_instances || this.data.n8n_instances.length === 0) {
      const now = new Date().toISOString();
      this.data.n8n_instances = [
        {
          id: "n8n_inst_primary_01",
          tenant_id: tenantId,
          name: "CommerceOS Primary Worker Cluster",
          environment: "PRODUCTION",
          base_url: "https://n8n.internal.commerceos.io",
          status: "ACTIVE",
          health_status: "HEALTHY",
          credential_reference: "cred_ref_vault_n8n_cluster",
          workflow_namespace: "commerceos-prod",
          latency_ms: 18,
          last_health_check_at: now,
          workflow_count: 14,
          failure_rate: 0.01,
          created_at: now,
          updated_at: now,
        },
      ];
    }

    // Seed Phase 12: Platform Feature Flags if empty
    if (!this.data.platform_feature_flags || this.data.platform_feature_flags.length === 0) {
      const now = new Date().toISOString();
      this.data.platform_feature_flags = [
        {
          id: "flag_auto_v2",
          key: "automation.v2_engine",
          description: "Enable high-throughput event-driven worker execution engine",
          is_enabled_globally: true,
          percentage_rollout: 100,
          scope: "GLOBAL",
          tenant_allowlist: [],
          rules: {},
          created_at: now,
          updated_at: now,
        },
        {
          id: "flag_ai_flash",
          key: "ai.gemini_flash_multimodal",
          description: "Use Gemini 1.5 Flash for high-speed catalog image and voucher OCR processing",
          is_enabled_globally: true,
          percentage_rollout: 100,
          scope: "GLOBAL",
          tenant_allowlist: [],
          rules: {},
          created_at: now,
          updated_at: now,
        },
        {
          id: "flag_cross_border",
          key: "shipping.cross_border",
          description: "Cross-border logistics integration with customs tracking",
          is_enabled_globally: false,
          percentage_rollout: 0,
          scope: "TENANT",
          tenant_allowlist: [],
          rules: {},
          created_at: now,
          updated_at: now,
        },
      ];
    }

    // Seed Phase 12: Platform Settings if empty
    if (!this.data.platform_settings || this.data.platform_settings.length === 0) {
      const now = new Date().toISOString();
      this.data.platform_settings = [
        {
          key: "security.mfa_enforced",
          value: true,
          category: "SECURITY",
          description: "Require TOTP/WebAuthn MFA for all platform staff operators",
          is_sensitive: false,
          updated_at: now,
        },
        {
          key: "security.privileged_session_lifetime_seconds",
          value: 3600,
          category: "SECURITY",
          description: "Maximum validity duration for privileged platform session tokens (seconds)",
          is_sensitive: false,
          updated_at: now,
        },
        {
          key: "automation.max_concurrency_global",
          value: 100,
          category: "N8N_CLUSTER",
          description: "Global threshold for concurrent automation workflow executions across all tenants",
          is_sensitive: false,
          updated_at: now,
        },
        {
          key: "rate_limits.platform_api_rpm",
          value: 1200,
          category: "RATE_LIMITS",
          description: "Max platform API requests per minute per IP address",
          is_sensitive: false,
          updated_at: now,
        },
      ];
    }

    this.persist();
  }

  // ==================== TENANTS ====================
  public getTenants(): TenantRecord[] {
    return [...this.data.tenants];
  }

  public findTenantById(id: string): TenantRecord | undefined {
    return this.data.tenants.find((t) => t.id === id);
  }

  public findTenantBySlug(slug: string): TenantRecord | undefined {
    return this.data.tenants.find((t) => t.slug === slug);
  }

  public createTenant(tenant: TenantRecord): TenantRecord {
    this.data.tenants.push(tenant);
    // Automatically seed a default warehouse for new tenants
    this.data.warehouses.push({
      // Random, like ensureDefaultWarehouse: the first 8 characters of the tenant id collided between tenants (review M3)
      id: `wh_${randomSuffix()}`,
      tenant_id: tenant.id,
      name: `${tenant.name} Central Warehouse`,
      code: "WH-01",
      address: "Primary Facility",
      city: "Dhaka",
      district: "Dhaka",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.persist();
    return tenant;
  }

  public updateTenant(id: string, updates: Partial<TenantRecord>): TenantRecord | undefined {
    const idx = this.data.tenants.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    this.data.tenants[idx] = {
      ...this.data.tenants[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.tenants[idx];
  }

  // ==================== USERS & MEMBERSHIPS ====================
  public findUserById(id: string): UserRecord | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  public findUserByEmail(email: string): UserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.email.toLowerCase() === normalized);
  }

  public createUser(user: UserRecord): UserRecord {
    this.data.users.push(user);
    this.persist();
    return user;
  }

  public updateUser(id: string, updates: Partial<UserRecord>): UserRecord | undefined {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    const current = this.data.users[idx];
    // A new password or an account status change signs the user out everywhere (FX-15).
    const revokeSessions =
      ("password_hash" in updates && updates.password_hash !== current.password_hash) ||
      ("status" in updates && updates.status !== current.status);
    this.data.users[idx] = {
      ...current,
      ...safePatch(updates),
      ...(revokeSessions ? { session_version: (current.session_version ?? 1) + 1 } : {}),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.users[idx];
  }

  public findMembershipsByUserId(userId: string): MembershipRecord[] {
    return this.data.memberships.filter((m) => m.user_id === userId);
  }

  public findMembershipsByTenantId(tenantId: string): MembershipRecord[] {
    return this.data.memberships.filter((m) => m.tenant_id === tenantId);
  }

  public findMembership(tenantId: string, userId: string): MembershipRecord | undefined {
    return this.data.memberships.find((m) => m.tenant_id === tenantId && m.user_id === userId);
  }

  public createMembership(membership: MembershipRecord): MembershipRecord {
    this.data.memberships.push(membership);
    this.persist();
    return membership;
  }

  public updateMembershipRole(tenantId: string, userId: string, role: RoleName): MembershipRecord | undefined {
    const idx = this.data.memberships.findIndex((m) => m.tenant_id === tenantId && m.user_id === userId);
    if (idx === -1) return undefined;
    this.data.memberships[idx].role = role;
    this.data.memberships[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.data.memberships[idx];
  }

  /** Revokes every session of a user ("sign out everywhere", FX-15). */
  public bumpSessionVersion(userId: string): number | undefined {
    const idx = this.data.users.findIndex((u) => u.id === userId);
    if (idx === -1) return undefined;
    const next = (this.data.users[idx].session_version ?? 1) + 1;
    this.data.users[idx] = { ...this.data.users[idx], session_version: next, updated_at: new Date().toISOString() };
    this.persist();
    return next;
  }

  // ==================== SERVICE TOKENS (FX-18) ====================
  public createServiceToken(token: ServiceTokenRecord): ServiceTokenRecord {
    this.data.service_tokens.push(token);
    this.persist();
    return token;
  }

  public getServiceTokens(tenantId: string): ServiceTokenRecord[] {
    return this.data.service_tokens.filter((t) => t.tenant_id === tenantId);
  }

  public findServiceTokenByHash(keyHash: string): ServiceTokenRecord | undefined {
    return this.data.service_tokens.find((t) => t.key_hash === keyHash);
  }

  public updateServiceToken(tenantId: string, id: string, patch: Partial<ServiceTokenRecord>): ServiceTokenRecord | undefined {
    const idx = this.data.service_tokens.findIndex((t) => t.tenant_id === tenantId && t.id === id);
    if (idx === -1) return undefined;
    this.data.service_tokens[idx] = { ...this.data.service_tokens[idx], ...safePatch(patch) };
    this.persist();
    return this.data.service_tokens[idx];
  }

  public updateMembershipStatus(tenantId: string, userId: string, status: "ACTIVE" | "SUSPENDED"): MembershipRecord | undefined {
    const idx = this.data.memberships.findIndex((m) => m.tenant_id === tenantId && m.user_id === userId);
    if (idx === -1) return undefined;
    this.data.memberships[idx] = { ...this.data.memberships[idx], status, updated_at: new Date().toISOString() };
    this.persist();
    return this.data.memberships[idx];
  }

  public removeMembership(tenantId: string, userId: string): boolean {
    const initialLen = this.data.memberships.length;
    this.data.memberships = this.data.memberships.filter((m) => !(m.tenant_id === tenantId && m.user_id === userId));
    const removed = this.data.memberships.length < initialLen;
    if (removed) this.persist();
    return removed;
  }

  // ==================== INVITATIONS ====================
  public createInvitation(invitation: InvitationRecord): InvitationRecord {
    this.data.invitations.push(invitation);
    this.persist();
    return invitation;
  }

  public findInvitationByToken(token: string): InvitationRecord | undefined {
    return this.data.invitations.find((i) => i.token === token);
  }

  public findInvitationsByTenant(tenantId: string): InvitationRecord[] {
    return this.data.invitations.filter((i) => i.tenant_id === tenantId);
  }

  public updateInvitationStatus(token: string, status: "ACCEPTED" | "EXPIRED"): InvitationRecord | undefined {
    const idx = this.data.invitations.findIndex((i) => i.token === token);
    if (idx === -1) return undefined;
    this.data.invitations[idx].status = status;
    this.persist();
    return this.data.invitations[idx];
  }

  public updateInvitation(tenantId: string, id: string, patch: Partial<InvitationRecord>): InvitationRecord | undefined {
    const idx = this.data.invitations.findIndex((i) => i.tenant_id === tenantId && i.id === id);
    if (idx === -1) return undefined;
    this.data.invitations[idx] = { ...this.data.invitations[idx], ...safePatch(patch) };
    this.persist();
    return this.data.invitations[idx];
  }

  // ==================== AUDIT LOGS ====================
  public createAuditLog(log: AuditLogRecord): AuditLogRecord {
    this.data.audit_logs.push(log);
    this.persist();
    return log;
  }

  public getAuditLogsByTenant(tenantId: string, limit = 50, offset = 0): { logs: AuditLogRecord[]; total: number } {
    const filtered = this.data.audit_logs
      .filter((l) => l.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return {
      logs: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  public findAuditLogs(tenantId: string, limit = 50): AuditLogRecord[] {
    return this.getAuditLogsByTenant(tenantId, limit).logs;
  }

  // ==================== PRODUCTS & VARIANTS ====================
  /**
   * One page of products. `limit` is required (FX-22): analytics that need every product must use getAllProducts,
   * not a silently truncated page.
   */
  public getProducts(
    tenantId: string,
    options: {
      category_id?: string;
      status?: string;
      search?: string;
      limit: number;
      offset?: number;
    }
  ): { products: Product[]; total: number } {
    let list = this.data.products.filter((p) => p.tenant_id === tenantId);

    if (options.category_id) {
      list = list.filter((p) => p.category_id === options.category_id);
    }
    if (options.status && options.status !== "ALL") {
      list = list.filter((p) => p.status === options.status);
    }
    if (options.search) {
      const q = options.search.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = list.length;
    const offset = options.offset || 0;
    const paginated = list.slice(offset, offset + options.limit);

    const variantsByProduct = this.variantsByProduct(tenantId, new Set(paginated.map((p) => p.id)));
    const populated = paginated.map((p) => ({ ...p, variants: variantsByProduct.get(p.id) ?? [] }));

    return { products: populated, total };
  }

  /** Every product of a tenant with its variants, in O(products + variants) (FX-22). For analytics, not UI pages. */
  public getAllProducts(tenantId: string): Product[] {
    const products = this.data.products.filter((p) => p.tenant_id === tenantId);
    const variantsByProduct = this.variantsByProduct(tenantId);
    return products.map((p) => ({ ...p, variants: variantsByProduct.get(p.id) ?? [] }));
  }

  private variantsByProduct(tenantId: string, only?: Set<string>): Map<string, ProductVariant[]> {
    const map = new Map<string, ProductVariant[]>();
    for (const v of this.data.product_variants) {
      if (v.tenant_id !== tenantId || (only && !only.has(v.product_id))) continue;
      const list = map.get(v.product_id);
      if (list) list.push(v);
      else map.set(v.product_id, [v]);
    }
    return map;
  }

  public findProductById(tenantId: string, id: string): Product | undefined {
    const p = this.data.products.find((prod) => prod.tenant_id === tenantId && prod.id === id);
    if (!p) return undefined;
    return {
      ...p,
      variants: this.data.product_variants.filter((v) => v.product_id === p.id && v.tenant_id === tenantId),
    };
  }

  public findProductBySlug(tenantId: string, slug: string): Product | undefined {
    const p = this.data.products.find((prod) => prod.tenant_id === tenantId && prod.slug === slug);
    if (!p) return undefined;
    return {
      ...p,
      variants: this.data.product_variants.filter((v) => v.product_id === p.id && v.tenant_id === tenantId),
    };
  }

  public findProductBySku(tenantId: string, sku: string): Product | undefined {
    const normalizedSku = sku.trim().toUpperCase();
    return this.data.products.find(
      (prod) => prod.tenant_id === tenantId && prod.sku.toUpperCase() === normalizedSku
    );
  }

  public createProduct(product: Product, initialStock = 0): Product {
    this.data.products.push(product);

    // If product has no variants, auto-generate standard primary variant
    if (!product.variants || product.variants.length === 0) {
      const defaultVariant: ProductVariant = {
        id: `var_${product.id}_def`,
        tenant_id: product.tenant_id,
        product_id: product.id,
        sku: product.sku,
        title: "Standard",
        price: product.base_price,
        compare_at_price: product.compare_at_price,
        cost_price: product.cost_price,
        attributes: { size: "Regular" },
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,
      };
      this.data.product_variants.push(defaultVariant);

      // Initialize inventory in this workspace's warehouse (never another tenant's, FX-36 M11)
      const defaultWarehouse = this.ensureDefaultWarehouse(product.tenant_id);
      if (defaultWarehouse) {
        this.data.inventory_items.push({
          id: `inv_${defaultVariant.id}`,
          tenant_id: product.tenant_id,
          warehouse_id: defaultWarehouse.id,
          product_variant_id: defaultVariant.id,
          quantity_on_hand: initialStock,
          quantity_reserved: 0,
          quantity_available: initialStock,
          reorder_point: 5,
          updated_at: new Date().toISOString(),
        });
        if (initialStock > 0) {
          this.data.stock_movements.push({
            id: `sm_${Date.now()}_init_${randomSuffix()}`,
            tenant_id: product.tenant_id,
            warehouse_id: defaultWarehouse.id,
            product_variant_id: defaultVariant.id,
            type: "PURCHASE",
            quantity: initialStock,
            reason: "Initial product creation stock",
            actor_user_id: "system",
            created_at: new Date().toISOString(),
          });
        }
      }
    } else {
      for (const v of product.variants) {
        const variantWithIds: ProductVariant = {
          ...v,
          product_id: v.product_id || product.id,
          tenant_id: v.tenant_id || product.tenant_id,
        };
        this.data.product_variants.push(variantWithIds);
        const defaultWarehouse = this.ensureDefaultWarehouse(product.tenant_id); // this workspace's (FX-36 M11)
        if (defaultWarehouse) {
          const vStock = typeof (v as any).initial_stock === "number"
            ? (v as any).initial_stock
            : typeof (v as any).stock === "number"
            ? (v as any).stock
            : initialStock;
          this.data.inventory_items.push({
            id: `inv_${variantWithIds.id}`,
            tenant_id: product.tenant_id,
            warehouse_id: defaultWarehouse.id,
            product_variant_id: variantWithIds.id,
            quantity_on_hand: vStock,
            quantity_reserved: 0,
            quantity_available: vStock,
            reorder_point: 5,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    this.persist();
    return this.findProductById(product.tenant_id, product.id)!;
  }

  public updateProduct(tenantId: string, id: string, updates: Partial<Product>): Product | undefined {
    const idx = this.data.products.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return undefined;
    this.data.products[idx] = {
      ...this.data.products[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.findProductById(tenantId, id);
  }

  public archiveProduct(tenantId: string, id: string): boolean {
    const idx = this.data.products.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return false;
    this.data.products[idx].status = "ARCHIVED";
    this.data.products[idx].updated_at = new Date().toISOString();
    this.persist();
    return true;
  }

  public findVariantById(tenantId: string, id: string): ProductVariant | undefined {
    return this.data.product_variants.find((v) => v.tenant_id === tenantId && v.id === id);
  }

  public findVariantBySku(tenantId: string, sku: string): ProductVariant | undefined {
    const norm = sku.trim().toUpperCase();
    return this.data.product_variants.find((v) => v.tenant_id === tenantId && v.sku.toUpperCase() === norm);
  }

  public getProductVariants(tenantId: string, productId: string): ProductVariant[] {
    return this.data.product_variants.filter((v) => v.tenant_id === tenantId && v.product_id === productId);
  }

  public getAllProductVariants(tenantId: string): ProductVariant[] {
    return this.data.product_variants.filter((v) => v.tenant_id === tenantId);
  }

  public updateProductVariant(tenantId: string, id: string, updates: Partial<ProductVariant>): ProductVariant | undefined {
    const idx = this.data.product_variants.findIndex((v) => v.tenant_id === tenantId && v.id === id);
    if (idx === -1) return undefined;
    this.data.product_variants[idx] = {
      ...this.data.product_variants[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.product_variants[idx];
  }

  public createProductVariant(tenantId: string, variant: Omit<ProductVariant, "tenant_id" | "id" | "created_at" | "updated_at"> & { id?: string }): ProductVariant {
    const newVariant: ProductVariant = {
      id: variant.id || `var_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      product_id: variant.product_id,
      sku: variant.sku,
      title: variant.title,
      price: variant.price,
      compare_at_price: variant.compare_at_price,
      cost_price: variant.cost_price,
      barcode: variant.barcode,
      weight: variant.weight,
      attributes: variant.attributes || {},
      status: variant.status || "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.product_variants.push(newVariant);
    this.persist();
    return newVariant;
  }

  // ==================== CATEGORIES & BRANDS ====================
  public getCategories(tenantId: string): Category[] {
    return this.data.categories.filter((c) => c.tenant_id === tenantId);
  }

  public createCategory(category: Category): Category {
    this.data.categories.push(category);
    this.persist();
    return category;
  }

  public getBrands(tenantId: string): Brand[] {
    return this.data.brands.filter((b) => b.tenant_id === tenantId);
  }

  public createBrand(brand: Brand): Brand {
    this.data.brands.push(brand);
    this.persist();
    return brand;
  }

  // ==================== WAREHOUSES & INVENTORY ====================
  public getWarehouses(tenantId: string): Warehouse[] {
    return this.data.warehouses.filter((w) => w.tenant_id === tenantId);
  }

  public createWarehouse(warehouse: Warehouse): Warehouse {
    this.data.warehouses.push(warehouse);
    this.persist();
    return warehouse;
  }

  /**
   * The workspace's first warehouse, creating a "Main warehouse" when it has none (FX-36 M11). Product creation and
   * bulk import used to fall back to `warehouses[0]`, another tenant's warehouse, for workspaces without one. The
   * address is left blank for the merchant to fill in; it isn't guessed.
   */
  public ensureDefaultWarehouse(tenantId: string): Warehouse {
    const existing = this.data.warehouses.find((w) => w.tenant_id === tenantId);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.createWarehouse({
      id: `wh_${randomSuffix()}`,
      tenant_id: tenantId,
      name: "Main warehouse",
      code: "MAIN",
      address: "",
      city: "",
      district: "",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
  }

  public getInventory(
    tenantId: string,
    options?: { warehouse_id?: string; low_stock_only?: boolean }
  ): (InventoryItem & { product_name: string; sku: string; variant_title: string })[] {
    let items = this.data.inventory_items.filter((i) => i.tenant_id === tenantId);

    if (options?.warehouse_id) {
      items = items.filter((i) => i.warehouse_id === options.warehouse_id);
    }
    if (options?.low_stock_only) {
      items = items.filter((i) => i.quantity_available <= i.reorder_point);
    }

    // Per-tenant indexes: O(I + V + P) instead of a scan of every tenant's catalog per row (FX-23)
    const variantsById = new Map<string, ProductVariant>();
    for (const v of this.data.product_variants) if (v.tenant_id === tenantId) variantsById.set(v.id, v);
    const productsById = new Map<string, Product>();
    for (const p of this.data.products) if (p.tenant_id === tenantId) productsById.set(p.id, p);

    return items.map((item) => {
      const variant = variantsById.get(item.product_variant_id);
      const product = variant ? productsById.get(variant.product_id) : undefined;
      return {
        ...item,
        product_name: product?.name || "Unknown Product",
        sku: variant?.sku || "UNKNOWN-SKU",
        variant_title: variant?.title || "Standard",
      };
    });
  }

  public findInventoryItem(tenantId: string, warehouseId: string, variantId: string): InventoryItem | undefined {
    return this.data.inventory_items.find(
      (i) => i.tenant_id === tenantId && i.warehouse_id === warehouseId && i.product_variant_id === variantId
    );
  }

  /**
   * Atomic stock adjustment with negative-inventory defense and mandatory audit logging
   */
  public adjustStock(
    tenantId: string,
    params: {
      warehouse_id: string;
      product_variant_id: string;
      quantity_delta: number;
      type: StockMovementType;
      reason: string;
      actor_user_id: string;
      reference_type?: string;
      reference_id?: string;
      allow_overselling?: boolean;
    }
  ): InventoryItem {
    let item = this.findInventoryItem(tenantId, params.warehouse_id, params.product_variant_id);
    let isNewItem = false;

    if (!item) {
      // A new stock row needs this workspace's own variant and warehouse. Any id used to be accepted, so another
      // workspace's ids created a phantom row (with the same id as that workspace's row), and Postgres refuses such a
      // row by its foreign keys (ADR-108).
      const variantOwned = this.data.product_variants.some((v) => v.id === params.product_variant_id && v.tenant_id === tenantId);
      const warehouseOwned = this.data.warehouses.some((w) => w.id === params.warehouse_id && w.tenant_id === tenantId);
      if (!variantOwned || !warehouseOwned) {
        throw new AppError("NOT_FOUND", !variantOwned ? "Product variant not found." : "Warehouse not found.", 404);
      }
      item = {
        id: `inv_${params.product_variant_id}_${params.warehouse_id}`,
        tenant_id: tenantId,
        warehouse_id: params.warehouse_id,
        product_variant_id: params.product_variant_id,
        quantity_on_hand: 0,
        quantity_reserved: 0,
        quantity_available: 0,
        reorder_point: 5,
        updated_at: new Date().toISOString(),
      };
      isNewItem = true;
    }

    const newOnHand = item.quantity_on_hand + params.quantity_delta;
    const newAvailable = newOnHand - item.quantity_reserved;

    if (newAvailable < 0 && !params.allow_overselling) {
      throw new Error(
        `Insufficient stock: Available quantity (${item.quantity_available}) cannot fulfill reduction of ${Math.abs(
          params.quantity_delta
        )}.`
      );
    }
    // Only now: a refused adjustment used to leave an empty stock row behind.
    if (isNewItem) this.data.inventory_items.push(item);

    item.quantity_on_hand = newOnHand;
    item.quantity_available = newAvailable;
    item.updated_at = new Date().toISOString();

    // Append-only stock movement record
    const movement: StockMovement = {
      id: `sm_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      warehouse_id: params.warehouse_id,
      product_variant_id: params.product_variant_id,
      type: params.type,
      quantity: params.quantity_delta,
      reason: params.reason,
      actor_user_id: params.actor_user_id,
      reference_type: params.reference_type,
      reference_id: params.reference_id,
      created_at: new Date().toISOString(),
    };
    this.data.stock_movements.push(movement);

    this.persist();
    return item;
  }

  /**
   * Atomic inventory reservation for checkout / order creation
   */
  public reserveStock(
    tenantId: string,
    params: {
      order_id: string;
      warehouse_id: string;
      product_variant_id: string;
      quantity: number;
      expires_minutes?: number;
    }
  ): InventoryReservation {
    if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
      throw new Error("Reservation quantity must be a whole number above zero."); // FX-35 step 5
    }
    const item = this.findInventoryItem(tenantId, params.warehouse_id, params.product_variant_id);
    if (!item || item.quantity_available < params.quantity) {
      throw new Error(
        `Cannot reserve ${params.quantity} units for variant ${params.product_variant_id}. Only ${
          item?.quantity_available || 0
        } available.`
      );
    }

    item.quantity_reserved += params.quantity;
    item.quantity_available = item.quantity_on_hand - item.quantity_reserved;
    item.updated_at = new Date().toISOString();

    // Unconfirmed orders hold stock for the tenant's setting (default 24 h, was a fixed 60 min); confirming extends it
    const holdSetting = Number((this.findTenantById(tenantId)?.settings as Record<string, unknown> | undefined)?.reservation_hold_minutes);
    const holdMinutes = params.expires_minutes ?? (Number.isFinite(holdSetting) && holdSetting > 0 ? holdSetting : 24 * 60);
    const expiresAt = new Date(Date.now() + holdMinutes * 60 * 1000).toISOString();

    const reservation: InventoryReservation = {
      id: `res_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      order_id: params.order_id,
      product_variant_id: params.product_variant_id,
      warehouse_id: params.warehouse_id,
      quantity: params.quantity,
      status: "ACTIVE",
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
    this.data.inventory_reservations.push(reservation);

    this.persist();
    return reservation;
  }

  public releaseReservation(tenantId: string, reservationId: string): boolean {
    const res = this.data.inventory_reservations.find(
      (r) => r.tenant_id === tenantId && r.id === reservationId && r.status === "ACTIVE"
    );
    if (!res) return false;

    const item = this.findInventoryItem(tenantId, res.warehouse_id, res.product_variant_id);
    if (item) {
      item.quantity_reserved = Math.max(0, item.quantity_reserved - res.quantity);
      item.quantity_available = item.quantity_on_hand - item.quantity_reserved;
      item.updated_at = new Date().toISOString();
    }

    res.status = "RELEASED";
    this.persist();
    return true;
  }

  public commitReservation(tenantId: string, reservationId: string, actorUserId: string): boolean {
    const res = this.data.inventory_reservations.find(
      (r) => r.tenant_id === tenantId && r.id === reservationId && r.status === "ACTIVE"
    );
    if (!res) return false;

    const item = this.findInventoryItem(tenantId, res.warehouse_id, res.product_variant_id);
    if (item) {
      item.quantity_on_hand -= res.quantity;
      item.quantity_reserved = Math.max(0, item.quantity_reserved - res.quantity);
      item.quantity_available = item.quantity_on_hand - item.quantity_reserved;
      item.updated_at = new Date().toISOString();

      this.data.stock_movements.push({
        id: `sm_${Date.now()}_sale_${randomSuffix()}`,
        tenant_id: tenantId,
        warehouse_id: res.warehouse_id,
        product_variant_id: res.product_variant_id,
        type: "SALE",
        quantity: -res.quantity,
        reference_type: "order",
        reference_id: res.order_id,
        reason: `Order ${res.order_id} committed fulfillment`,
        actor_user_id: actorUserId,
        created_at: new Date().toISOString(),
      });
    }

    res.status = "COMMITTED";
    this.persist();
    return true;
  }

  public getStockMovements(tenantId: string, limit = 50): StockMovement[] {
    return this.data.stock_movements
      .filter((m) => m.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // ==================== CUSTOMERS & ADDRESSES ====================
  /**
   * One page of customers. `limit` is required (FX-22): analytics that need every customer must use getAllCustomers,
   * not a silently truncated page.
   */
  public getCustomers(
    tenantId: string,
    options: { search?: string; limit: number; offset?: number }
  ): { customers: Customer[]; total: number } {
    let list = this.data.customers.filter((c) => c.tenant_id === tenantId);

    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.first_name.toLowerCase().includes(q) ||
          c.last_name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const total = list.length;
    const offset = options.offset || 0;
    const page = list.slice(offset, offset + options.limit);
    const addressesByCustomer = this.addressesByCustomer(tenantId, new Set(page.map((c) => c.id)));
    const populated = page.map((c) => ({ ...c, addresses: addressesByCustomer.get(c.id) ?? [] }));

    return { customers: populated, total };
  }

  /** Every customer of a tenant with addresses, in O(customers + addresses) (FX-22). For analytics, not UI pages. */
  public getAllCustomers(tenantId: string): Customer[] {
    const customers = this.data.customers.filter((c) => c.tenant_id === tenantId);
    const addressesByCustomer = this.addressesByCustomer(tenantId);
    return customers.map((c) => ({ ...c, addresses: addressesByCustomer.get(c.id) ?? [] }));
  }

  private addressesByCustomer(tenantId: string, only?: Set<string>): Map<string, CustomerAddress[]> {
    const map = new Map<string, CustomerAddress[]>();
    for (const a of this.data.customer_addresses) {
      if (a.tenant_id !== tenantId || (only && !only.has(a.customer_id))) continue;
      const list = map.get(a.customer_id);
      if (list) list.push(a);
      else map.set(a.customer_id, [a]);
    }
    return map;
  }

  public findCustomerById(tenantId: string, id: string): Customer | undefined {
    const c = this.data.customers.find((cust) => cust.tenant_id === tenantId && cust.id === id);
    if (!c) return undefined;
    return {
      ...c,
      addresses: this.data.customer_addresses.filter((a) => a.customer_id === c.id && a.tenant_id === tenantId),
    };
  }

  public findCustomerByPhone(tenantId: string, normalizedPhone: string): Customer | undefined {
    // An empty phone means "no phone" (social contacts): it must never match another customer (FX-30, N6)
    if (!normalizedPhone || !normalizedPhone.trim()) return undefined;
    return this.data.customers.find((c) => c.tenant_id === tenantId && c.phone === normalizedPhone);
  }

  public createCustomer(customer: Customer, initialAddress?: CustomerAddress): Customer {
    this.data.customers.push(customer);
    if (initialAddress) {
      this.data.customer_addresses.push(initialAddress);
    }
    this.persist();
    return this.findCustomerById(customer.tenant_id, customer.id)!;
  }

  public updateCustomer(tenantId: string, id: string, updates: Partial<Customer>): Customer | undefined {
    const idx = this.data.customers.findIndex((c) => c.tenant_id === tenantId && c.id === id);
    if (idx === -1) return undefined;
    this.data.customers[idx] = {
      ...this.data.customers[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.findCustomerById(tenantId, id);
  }

  public getCustomerAddresses(tenantId: string, customerId?: string): CustomerAddress[] {
    return this.data.customer_addresses.filter(
      (a) => a.tenant_id === tenantId && (!customerId || a.customer_id === customerId)
    );
  }

  public getReservations(tenantId: string): InventoryReservation[] {
    return this.data.inventory_reservations.filter((r) => r.tenant_id === tenantId);
  }

  public getReservationsForOrder(tenantId: string, orderId: string): InventoryReservation[] {
    return this.data.inventory_reservations.filter((r) => r.tenant_id === tenantId && r.order_id === orderId);
  }

  /** Keeps a confirmed order's stock held (FX-35). */
  public extendReservations(tenantId: string, orderId: string, expiresAt: string): void {
    let changed = false;
    for (const r of this.data.inventory_reservations) {
      if (r.tenant_id === tenantId && r.order_id === orderId && r.status === "ACTIVE" && r.expires_at < expiresAt) {
        r.expires_at = expiresAt;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  /**
   * Releases stock held by unconfirmed (PENDING) orders past their hold time; the reservation becomes EXPIRED and is
   * taken again if the order is confirmed later (FX-35 step 3). Holds of confirmed orders are left alone.
   */
  public releaseExpiredReservations(now = Date.now()): number {
    let released = 0;
    for (const r of this.data.inventory_reservations) {
      if (r.status !== "ACTIVE" || Date.parse(r.expires_at) >= now) continue;
      const order = this.data.orders.find((o) => o.tenant_id === r.tenant_id && o.id === r.order_id);
      if (order && order.status !== "PENDING") continue;
      const item = this.findInventoryItem(r.tenant_id, r.warehouse_id, r.product_variant_id);
      if (item) {
        item.quantity_reserved = Math.max(0, item.quantity_reserved - r.quantity);
        item.quantity_available = item.quantity_on_hand - item.quantity_reserved;
        item.updated_at = new Date(now).toISOString();
      }
      r.status = "EXPIRED";
      released++;
    }
    if (released) this.persist();
    return released;
  }

  // ==================== ORDERS & ITEMS ====================
  /**
   * The next order number for a tenant, from a per-tenant counter (FX-35 step 4). It used to be "orders so far + 1",
   * computed before the awaits in order creation, so two concurrent orders (or a deleted one) produced duplicates.
   * Synchronous, so atomic within the one writer process; the counter starts past any number already issued.
   */
  public generateOrderNumber(tenantId: string): string {
    if (!this.data.order_sequences) this.data.order_sequences = {};
    let last = this.data.order_sequences[tenantId];
    if (last === undefined) {
      last = 0;
      for (const o of this.data.orders) {
        if (o.tenant_id !== tenantId) continue;
        const n = Number(/-(\d+)$/.exec(o.order_number ?? "")?.[1]);
        if (Number.isFinite(n) && n > last) last = n;
      }
    }
    const next = last + 1;
    this.data.order_sequences[tenantId] = next;
    this.persist();
    return `ORD-${new Date().getFullYear()}-${next.toString().padStart(6, "0")}`;
  }

  public getOrders(
    tenantId: string,
    options: {
      status?: string;
      payment_status?: string;
      customer_id?: string;
      search?: string;
      limit: number;
      offset?: number;
    }
  ): { orders: (Order & { customer_name: string; customer_phone: string })[]; total: number } {
    // `limit` is required (FX-22): analytics that need every order must use getAllOrders.
    let list = this.data.orders.filter((o) => o.tenant_id === tenantId);
    const customersById = this.customersById(tenantId);

    if (options.status && options.status !== "ALL") {
      list = list.filter((o) => o.status === options.status);
    }
    if (options?.payment_status && options.payment_status !== "ALL") {
      list = list.filter((o) => o.payment_status === options.payment_status);
    }
    if (options?.customer_id) {
      list = list.filter((o) => o.customer_id === options.customer_id);
    }
    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      list = list.filter((o) => {
        if (o.order_number.toLowerCase().includes(q)) return true;
        const cust = customersById.get(o.customer_id);
        if (cust) {
          if (`${cust.first_name} ${cust.last_name}`.toLowerCase().includes(q)) return true;
          if (cust.phone.includes(q)) return true;
        }
        return false;
      });
    }

    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const total = list.length;
    const offset = options.offset || 0;
    const page = list.slice(offset, offset + options.limit);
    const itemsByOrder = this.itemsByOrder(tenantId, new Set(page.map((o) => o.id)));
    const populated = page.map((o) => this.hydrateOrder(o, itemsByOrder, customersById));

    return { orders: populated, total };
  }

  /**
   * Every order of a tenant (FX-22). Plain rows by default; `hydrate` adds items, customer_name and customer_phone
   * (the getOrders shape) using maps, so it stays O(orders + items + customers).
   */
  public getAllOrders(tenantId: string): Order[];
  public getAllOrders(tenantId: string, opts: { hydrate: true }): (Order & { customer_name: string; customer_phone: string })[];
  public getAllOrders(tenantId: string, opts: { hydrate?: boolean } = {}): Order[] {
    const orders = this.data.orders.filter((o) => o.tenant_id === tenantId);
    if (!opts.hydrate) return orders;
    const itemsByOrder = this.itemsByOrder(tenantId);
    const customersById = this.customersById(tenantId);
    return orders.map((o) => this.hydrateOrder(o, itemsByOrder, customersById));
  }

  private customersById(tenantId: string): Map<string, Customer> {
    const map = new Map<string, Customer>();
    for (const c of this.data.customers) if (c.tenant_id === tenantId) map.set(c.id, c);
    return map;
  }

  private itemsByOrder(tenantId: string, only?: Set<string>): Map<string, OrderItem[]> {
    const map = new Map<string, OrderItem[]>();
    for (const it of this.data.order_items) {
      if (it.tenant_id !== tenantId || (only && !only.has(it.order_id))) continue;
      const list = map.get(it.order_id);
      if (list) list.push(it);
      else map.set(it.order_id, [it]);
    }
    return map;
  }

  private hydrateOrder(
    o: Order,
    itemsByOrder: Map<string, OrderItem[]>,
    customersById: Map<string, Customer>
  ): Order & { customer_name: string; customer_phone: string } {
    const cust = customersById.get(o.customer_id);
    return {
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
      customer_name: cust ? `${cust.first_name} ${cust.last_name}` : "Walk-in Customer",
      customer_phone: cust?.phone || "",
    };
  }

  public findOrderById(tenantId: string, id: string): (Order & { customer_name: string; customer_phone: string }) | undefined {
    const o = this.data.orders.find((ord) => ord.tenant_id === tenantId && ord.id === id);
    if (!o) return undefined;
    const cust = this.data.customers.find((c) => c.tenant_id === tenantId && c.id === o.customer_id);
    return {
      ...o,
      items: this.data.order_items.filter((item) => item.order_id === o.id && item.tenant_id === tenantId),
      customer_name: cust ? `${cust.first_name} ${cust.last_name}` : "Walk-in Customer",
      customer_phone: cust?.phone || "",
    };
  }

  public findOrderByNumber(tenantId: string, orderNumber: string): Order | undefined {
    return this.data.orders.find((o) => o.tenant_id === tenantId && o.order_number === orderNumber);
  }

  public getOrderItems(tenantId: string, orderId: string): OrderItem[] {
    return this.data.order_items.filter((i) => i.tenant_id === tenantId && i.order_id === orderId);
  }

  public createOrder(order: Order, items: OrderItem[]): Order {
    this.data.orders.push(order);
    for (const item of items) {
      this.data.order_items.push(item);
    }

    // Update customer stats
    const cust = this.data.customers.find((c) => c.id === order.customer_id && c.tenant_id === order.tenant_id);
    if (cust) {
      cust.total_orders = (cust.total_orders || 0) + 1;
      cust.total_spent = (cust.total_spent || 0) + order.grand_total;
      cust.last_order_at = order.created_at;
      cust.updated_at = new Date().toISOString();
    }

    this.persist();
    return this.findOrderById(order.tenant_id, order.id)!;
  }

  public updateOrderStatus(tenantId: string, orderId: string, status: OrderStatus): Order | undefined {
    const idx = this.data.orders.findIndex((o) => o.tenant_id === tenantId && o.id === orderId);
    if (idx === -1) return undefined;
    this.data.orders[idx].status = status;
    this.data.orders[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.findOrderById(tenantId, orderId);
  }

  public updateOrderPaymentStatus(tenantId: string, orderId: string, status: PaymentStatus): Order | undefined {
    const idx = this.data.orders.findIndex((o) => o.tenant_id === tenantId && o.id === orderId);
    if (idx === -1) return undefined;
    this.data.orders[idx].payment_status = status;
    this.data.orders[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.findOrderById(tenantId, orderId);
  }

  public updateOrderFulfillmentStatus(tenantId: string, orderId: string, status: FulfillmentStatus): Order | undefined {
    const idx = this.data.orders.findIndex((o) => o.tenant_id === tenantId && o.id === orderId);
    if (idx === -1) return undefined;
    this.data.orders[idx].fulfillment_status = status;
    this.data.orders[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.findOrderById(tenantId, orderId);
  }

  // ==================== PAYMENTS ====================
  public getPayments(tenantId: string, orderId?: string): Payment[] {
    let list = this.data.payments.filter((p) => p.tenant_id === tenantId);
    if (orderId) list = list.filter((p) => p.order_id === orderId);
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public findPaymentById(tenantId: string, id: string): Payment | undefined {
    return this.data.payments.find((p) => p.tenant_id === tenantId && p.id === id);
  }

  /** A payment in this tenant already carrying this provider transaction id (TrxIDs are single-use, FX-11). */
  public findPaymentByTransactionId(tenantId: string, provider: Payment["provider"], transactionId: string): Payment | undefined {
    const trx = transactionId.trim().toUpperCase();
    return this.data.payments.find(
      (p) => p.tenant_id === tenantId && p.provider === provider && (p.transaction_id || "").trim().toUpperCase() === trx
    );
  }

  public recordPaymentVerification(
    tenantId: string,
    id: string,
    verification: { transactionId: string; verifiedBy: string; method: "MANUAL" | "GATEWAY" }
  ): Payment | undefined {
    const idx = this.data.payments.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return undefined;
    this.data.payments[idx] = {
      ...this.data.payments[idx],
      status: "PAID",
      transaction_id: verification.transactionId,
      verification_method: verification.method,
      verified_by: verification.verifiedBy,
      verified_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.payments[idx];
  }

  public findPaymentByIdempotency(tenantId: string, key: string): Payment | undefined {
    return this.data.payments.find((p) => p.tenant_id === tenantId && p.idempotency_key === key);
  }

  public createPayment(payment: Payment): Payment {
    this.data.payments.push(payment);
    this.persist();
    return payment;
  }

  public updatePaymentStatus(tenantId: string, id: string, status: PaymentStatus, transactionId?: string): Payment | undefined {
    const idx = this.data.payments.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return undefined;
    this.data.payments[idx].status = status;
    if (transactionId) this.data.payments[idx].transaction_id = transactionId;
    this.persist();
    return this.data.payments[idx];
  }

  // ==================== SHIPMENTS ====================
  public getShipments(tenantId: string, orderId?: string): Shipment[] {
    let list = this.data.shipments.filter((s) => s.tenant_id === tenantId);
    if (orderId) list = list.filter((s) => s.order_id === orderId);
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public findShipmentById(tenantId: string, id: string): Shipment | undefined {
    return this.data.shipments.find((s) => s.tenant_id === tenantId && s.id === id);
  }

  public createShipment(shipment: Shipment): Shipment {
    this.data.shipments.push(shipment);
    this.persist();
    return shipment;
  }

  public updateShipmentStatus(tenantId: string, id: string, status: DeliveryStatus): Shipment | undefined {
    const idx = this.data.shipments.findIndex((s) => s.tenant_id === tenantId && s.id === id);
    if (idx === -1) return undefined;
    this.data.shipments[idx].status = status;
    if (status === "DELIVERED") {
      this.data.shipments[idx].delivered_at = new Date().toISOString();
    }
    this.data.shipments[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.data.shipments[idx];
  }

  // ==================== RETURNS & REFUNDS ====================
  public getReturns(tenantId: string): Return[] {
    return this.data.returns.filter((r) => r.tenant_id === tenantId);
  }

  public createReturn(returnRecord: Return): Return {
    this.data.returns.push(returnRecord);
    this.persist();
    return returnRecord;
  }

  public updateReturnStatus(tenantId: string, id: string, status: Return["status"]): Return | undefined {
    const idx = this.data.returns.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) return undefined;
    this.data.returns[idx].status = status;
    this.data.returns[idx].updated_at = new Date().toISOString();
    this.persist();
    return this.data.returns[idx];
  }

  public getRefunds(tenantId: string): Refund[] {
    return this.data.refunds.filter((r) => r.tenant_id === tenantId);
  }

  public createRefund(refund: Refund): Refund {
    this.data.refunds.push(refund);
    this.persist();
    return refund;
  }

  // ==================== COUPONS ====================
  public getCoupons(tenantId: string): Coupon[] {
    return this.data.coupons.filter((c) => c.tenant_id === tenantId);
  }

  public findCouponByCode(tenantId: string, code: string): Coupon | undefined {
    const normalized = code.trim().toUpperCase();
    return this.data.coupons.find((c) => c.tenant_id === tenantId && c.code === normalized);
  }

  public createCoupon(coupon: Coupon): Coupon {
    this.data.coupons.push(coupon);
    this.persist();
    return coupon;
  }

  public incrementCouponUsage(tenantId: string, code: string): void {
    const c = this.findCouponByCode(tenantId, code);
    if (c) {
      c.usage_count = (c.usage_count || 0) + 1;
      this.persist();
    }
  }

  // ==================== COMMERCE EVENTS ====================
  public recordEvent(event: CommerceEvent): CommerceEvent {
    this.data.events.push(event);
    this.persist();
    return event;
  }

  public getEvents(tenantId: string, limit = 50): CommerceEvent[] {
    return this.data.events
      .filter((e) => e.tenant_id === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // ==================== WEBHOOKS ====================
  public getWebhooks(tenantId: string): WebhookSubscription[] {
    return this.data.webhooks.filter((w) => w.tenant_id === tenantId);
  }

  public createWebhook(webhook: WebhookSubscription): WebhookSubscription {
    this.data.webhooks.push(webhook);
    this.persist();
    return webhook;
  }

  // ==================== KPI AGGREGATION (REAL DB DATA) ====================
  /**
   * Command Center numbers, computed from the tenant's records only (FX-39). Unknown values are null; the page shows
   * "—" or an empty state instead of the fallbacks it used to render.
   */
  public getDashboardMetrics(tenantId: string): {
    totalRevenue: number;
    totalOrders: number;
    activeCustomers: number;
    averageOrderValue: number;
    totalProducts: number;
    lowStockCount: number;
    pendingOrdersCount: number;
    pendingPaymentsCount: number;
    totalStockUnits: number;
    warehousesCount: number;
    /** Share of buying customers with 2+ orders; null without buyers. */
    returningBuyerPercent: number | null;
    /** Share of non-cancelled orders by payment method (percent, one decimal). */
    paymentMix: Array<{ method: string; percent: number }>;
    recentOrders: (Order & { customer_name: string; channel: string; is_returning: boolean; courier: string | null })[];
    periodComparison: {
      revenue_last_30d: number;
      revenue_prev_30d: number;
      revenue_change_pct: number | null;
      orders_last_30d: number;
      orders_prev_30d: number;
      orders_change_pct: number | null;
    };
    channelData: Array<{
      id: string;
      shortName: string;
      channel: string;
      icon: string;
      color: string;
      orders: number;
      sharePercent: number;
      revenueBDT: number;
      conversion: string | null;
      agentStatus: string;
    }>;
    cityAnalysisData: Array<{
      id: string;
      city: string;
      division: string;
      orders: number;
      volumePercent: number;
      revenueBDT: number;
      returningBuyerPercent: number | null;
      repeatAOV: number | null;
      reorderFreq: string | null;
      loyalty: string | null;
      deliverySLA: string | null;
      growth: string | null;
      color: string;
    }>;
  } {
    const orders = this.data.orders.filter((o) => o.tenant_id === tenantId);
    const paidOrders = orders.filter((o) => o.payment_status === "PAID");
    const totalRevenue = paidOrders.reduce((sum, o) => sum + o.grand_total, 0);
    const totalOrders = orders.length;
    const averageOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;

    const customers = this.data.customers.filter((c) => c.tenant_id === tenantId);
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const activeCustomers = customers.filter((c) => c.status === "ACTIVE").length;

    const products = this.data.products.filter((p) => p.tenant_id === tenantId && p.status !== "ARCHIVED");
    const totalProducts = products.length;

    const inventory = this.data.inventory_items.filter((i) => i.tenant_id === tenantId);
    const lowStockCount = inventory.filter((i) => i.quantity_available <= i.reorder_point).length;

    const pendingOrdersCount = orders.filter(
      (o) => o.status === "PENDING" || o.status === "CONFIRMED" || o.status === "PROCESSING"
    ).length;

    const pendingPaymentsCount = orders.filter(
      (o) => o.payment_status === "PENDING" || o.payment_status === "UNPAID"
    ).length;

    const ordersPerCustomer = new Map<string, number>();
    for (const o of orders) {
      if (o.status !== "CANCELLED") ordersPerCustomer.set(o.customer_id, (ordersPerCustomer.get(o.customer_id) ?? 0) + 1);
    }
    const buyers = ordersPerCustomer.size;
    const returningBuyers = [...ordersPerCustomer.values()].filter((n) => n >= 2).length;
    const returningBuyerPercent = buyers > 0 ? Number(((returningBuyers / buyers) * 100).toFixed(1)) : null;

    const methodCounts = new Map<string, number>();
    const nonCancelled = orders.filter((o) => o.status !== "CANCELLED");
    for (const o of nonCancelled) methodCounts.set(o.payment_method, (methodCounts.get(o.payment_method) ?? 0) + 1);
    const paymentMix = [...methodCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, count]) => ({ method, percent: Number(((count / nonCancelled.length) * 100).toFixed(1)) }));

    const couriersByOrder = new Map<string, string>();
    for (const sh of this.data.shipments) if (sh.tenant_id === tenantId) couriersByOrder.set(sh.order_id, sh.courier_provider);

    const recent = [...orders]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map((o) => {
        const cust = customersById.get(o.customer_id);
        return {
          ...o,
          customer_name: cust ? `${cust.first_name} ${cust.last_name}`.trim() : "Walk-in customer",
          channel: SALES_CHANNEL_NAMES[channelOfOrder(o)].split(" (")[0],
          is_returning: (ordersPerCustomer.get(o.customer_id) ?? 0) >= 2,
          courier: couriersByOrder.get(o.id) ?? null,
        };
      });

    // Last 30 days against the 30 before, for trend pills (FX-39: the page showed literal +18.4% / +12.6% / ...)
    const now = Date.now();
    const day = 86_400_000;
    const inRange = (o: Order, from: number, to: number) => {
      const t = Date.parse(o.created_at);
      return t >= from && t < to && o.status !== "CANCELLED";
    };
    const last30 = orders.filter((o) => inRange(o, now - 30 * day, now + 1));
    const prev30 = orders.filter((o) => inRange(o, now - 60 * day, now - 30 * day));
    const paidSum = (list: Order[]) => list.filter((o) => o.payment_status === "PAID").reduce((sum, o) => sum + o.grand_total, 0);
    const change = (current: number, previous: number) =>
      previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
    const periodComparison = {
      revenue_last_30d: Math.round(paidSum(last30)),
      revenue_prev_30d: Math.round(paidSum(prev30)),
      revenue_change_pct: change(paidSum(last30), paidSum(prev30)),
      orders_last_30d: last30.length,
      orders_prev_30d: prev30.length,
      orders_change_pct: change(last30.length, prev30.length),
    };

    // Channels from what each order records; unknown ones are Unattributed (was: every unknown order counted as
    // Facebook). No conversion rates exist (there's no visit data); "agent status" is the channel's real connection.
    const activeChannelTypes = new Set(
      this.data.connected_channels.filter((c) => c.tenant_id === tenantId && c.status === "ACTIVE").map((c) => c.type as string)
    );
    const channelStyle: Record<OrderSalesChannel, { id: string; channel: string; icon: string; color: string; connectedAs?: string }> = {
      FACEBOOK_MESSENGER: { id: "facebook", channel: "Facebook Page & Messenger", icon: "💬", color: "#1877f2", connectedAs: "FACEBOOK_MESSENGER" },
      WHATSAPP: { id: "whatsapp", channel: "WhatsApp", icon: "🟢", color: "#25d366", connectedAs: "WHATSAPP" },
      INSTAGRAM: { id: "instagram", channel: "Instagram Direct", icon: "📸", color: "#e1306c", connectedAs: "INSTAGRAM" },
      WEBSITE: { id: "website", channel: "Website Storefront", icon: "🌐", color: "#3b82f6", connectedAs: "WEBSITE_CHAT" },
      MANUAL_POS: { id: "manual", channel: "Manual Phone & Offline", icon: "📞", color: "#6b7280" },
      UNATTRIBUTED: { id: "unattributed", channel: "Channel not recorded", icon: "❔", color: "#9ca3af" },
    };
    const tallies = new Map<OrderSalesChannel, { orders: number; revenue: number }>();
    for (const o of orders) {
      const key = channelOfOrder(o);
      const t = tallies.get(key) ?? { orders: 0, revenue: 0 };
      t.orders += 1;
      if (o.payment_status === "PAID") t.revenue += o.grand_total;
      tallies.set(key, t);
    }
    const channelData = (Object.keys(channelStyle) as OrderSalesChannel[])
      .filter((key) => key !== "UNATTRIBUTED" || (tallies.get(key)?.orders ?? 0) > 0)
      .map((key) => {
        const style = channelStyle[key];
        const t = tallies.get(key) ?? { orders: 0, revenue: 0 };
        return {
          id: style.id,
          shortName: SALES_CHANNEL_NAMES[key].split(" (")[0],
          channel: style.channel,
          icon: style.icon,
          color: style.color,
          orders: t.orders,
          sharePercent: totalOrders > 0 ? Number(((t.orders / totalOrders) * 100).toFixed(1)) : 0,
          revenueBDT: Math.round(t.revenue),
          conversion: null,
          // Sending isn't integrated for any social channel yet (FX-31), so an active channel only receives messages
          agentStatus: style.connectedAs ? (activeChannelTypes.has(style.connectedAs) ? "Receiving only" : "Not connected") : "—",
        };
      });

    // By division, from shipping addresses. Returning-buyer share and orders per customer are computed from each
    // division's customers; loyalty labels, growth and SLA were literals and are not known (null).
    const divisionColors: Record<string, string> = {
      Dhaka: "#84cc16", Chattogram: "#3b82f6", Sylhet: "#a855f7", Rajshahi: "#f59e0b",
      Khulna: "#06b6d4", Barishal: "#ec4899", Rangpur: "#14b8a6", Mymensingh: "#8b5cf6",
    };
    const divisionStats = new Map<string, { orders: number; revenue: number; ordersByCustomer: Map<string, number> }>();
    for (const o of orders) {
      const div = o.shipping_address_snapshot?.division || "Not recorded";
      const stat = divisionStats.get(div) ?? { orders: 0, revenue: 0, ordersByCustomer: new Map<string, number>() };
      stat.orders += 1;
      if (o.payment_status === "PAID") stat.revenue += o.grand_total;
      stat.ordersByCustomer.set(o.customer_id, (stat.ordersByCustomer.get(o.customer_id) ?? 0) + 1);
      divisionStats.set(div, stat);
    }
    const cityAnalysisData = [...divisionStats.entries()]
      .sort((a, b) => b[1].orders - a[1].orders)
      .map(([division, stat]) => {
        const buyers = stat.ordersByCustomer.size;
        const returning = [...stat.ordersByCustomer.values()].filter((n) => n >= 2).length;
        return {
          id: division.toLowerCase().replace(/\s+/g, "-"),
          city: division,
          division,
          orders: stat.orders,
          volumePercent: totalOrders > 0 ? Number(((stat.orders / totalOrders) * 100).toFixed(1)) : 0,
          revenueBDT: Math.round(stat.revenue),
          returningBuyerPercent: buyers > 0 ? Number(((returning / buyers) * 100).toFixed(1)) : null,
          repeatAOV: stat.orders > 0 && stat.revenue > 0 ? Math.round(stat.revenue / stat.orders) : null,
          reorderFreq: buyers > 0 ? `${(stat.orders / buyers).toFixed(1)}x` : null,
          loyalty: null,
          deliverySLA: null,
          growth: null,
          color: divisionColors[division] ?? "#9ca3af",
        };
      });

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      activeCustomers,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      totalProducts,
      lowStockCount,
      pendingOrdersCount,
      pendingPaymentsCount,
      totalStockUnits: inventory.reduce((sum, i) => sum + i.quantity_on_hand, 0),
      warehousesCount: this.data.warehouses.filter((w) => w.tenant_id === tenantId).length,
      returningBuyerPercent,
      paymentMix,
      recentOrders: recent,
      periodComparison,
      channelData,
      cityAnalysisData,
    };
  }

  // ==================== SOCIAL COMMERCE: CHANNELS ====================
  public getConnectedChannels(tenantId: string): ConnectedChannel[] {
    return this.data.connected_channels.filter((c) => c.tenant_id === tenantId);
  }

  public findConnectedChannelById(tenantId: string, id: string): ConnectedChannel | undefined {
    return this.data.connected_channels.find((c) => c.tenant_id === tenantId && c.id === id);
  }

  /**
   * Server-side lookup for inbound webhook/widget traffic by the channel's public id. The caller must still
   * verify the request (signature, or the widget's channel-type check); the row's tenant_id is authoritative.
   */
  public findConnectedChannelForIngress(id: string): ConnectedChannel | undefined {
    return this.data.connected_channels.find((c) => c.id === id);
  }

  /**
   * Every channel (any tenant, any status) registered for a provider account. Callers must treat more than one
   * match as ambiguous rather than picking the first (audit H5).
   */
  public findConnectedChannelsByProviderId(type: ChannelType, providerAccountId: string): ConnectedChannel[] {
    return this.data.connected_channels.filter(
      (c) => c.type === type && c.provider_account_id === providerAccountId
    );
  }

  public createConnectedChannel(channel: ConnectedChannel): ConnectedChannel {
    this.data.connected_channels.push(channel);
    this.persist();
    return channel;
  }

  public updateConnectedChannel(tenantId: string, id: string, patch: Partial<ConnectedChannel>): ConnectedChannel {
    const idx = this.data.connected_channels.findIndex((c) => c.tenant_id === tenantId && c.id === id);
    if (idx === -1) {
      throw new Error(`Connected channel '${id}' not found for tenant '${tenantId}'`);
    }
    const updated = {
      ...this.data.connected_channels[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.data.connected_channels[idx] = updated;
    this.persist();
    return updated;
  }

  public deleteConnectedChannel(tenantId: string, id: string): boolean {
    const initialLen = this.data.connected_channels.length;
    this.data.connected_channels = this.data.connected_channels.filter(
      (c) => !(c.tenant_id === tenantId && c.id === id)
    );
    const deleted = this.data.connected_channels.length < initialLen;
    if (deleted) this.persist();
    return deleted;
  }

  // ==================== SOCIAL COMMERCE: CUSTOMER IDENTITIES ====================
  public getCustomerIdentities(tenantId: string, customerId?: string): CustomerIdentity[] {
    return this.data.customer_identities.filter((ci) => {
      if (ci.tenant_id !== tenantId) return false;
      if (customerId && ci.customer_id !== customerId) return false;
      return true;
    });
  }

  public findCustomerIdentity(tenantId: string, channelId: string, externalUserId: string): CustomerIdentity | undefined {
    return this.data.customer_identities.find(
      (ci) => ci.tenant_id === tenantId && ci.channel_id === channelId && ci.external_user_id === externalUserId
    );
  }

  public findCustomerIdentityByChannelAndExternalId(channelType: ChannelType, externalUserId: string): CustomerIdentity | undefined {
    return this.data.customer_identities.find(
      (ci) => ci.channel_type === channelType && ci.external_user_id === externalUserId
    );
  }

  public createCustomerIdentity(identity: CustomerIdentity): CustomerIdentity {
    // Check unique constraint: (tenant_id, channel_id, external_user_id)
    const existing = this.findCustomerIdentity(identity.tenant_id, identity.channel_id, identity.external_user_id);
    if (existing) {
      return this.updateCustomerIdentity(identity.tenant_id, existing.id, identity);
    }
    this.data.customer_identities.push(identity);
    this.persist();
    return identity;
  }

  public updateCustomerIdentity(tenantId: string, id: string, patch: Partial<CustomerIdentity>): CustomerIdentity {
    const idx = this.data.customer_identities.findIndex((ci) => ci.tenant_id === tenantId && ci.id === id);
    if (idx === -1) {
      throw new Error(`Customer identity '${id}' not found`);
    }
    const updated = {
      ...this.data.customer_identities[idx],
      ...safePatch(patch),
      last_seen_at: new Date().toISOString(),
    };
    this.data.customer_identities[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== SOCIAL COMMERCE: CONVERSATIONS ====================
  public getConversations(
    tenantId: string,
    options?: {
      channel_id?: string;
      channel_type?: string;
      status?: string;
      priority?: string;
      assigned_user_id?: string;
      assigned_team_id?: string;
      unread_only?: boolean;
      tag?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): { conversations: (Conversation & { customer?: Customer; channel_name?: string })[]; total: number } {
    let list = this.data.conversations.filter((c) => c.tenant_id === tenantId);

    if (options?.channel_id) {
      list = list.filter((c) => c.channel_id === options.channel_id);
    }
    if (options?.channel_type) {
      list = list.filter((c) => c.channel_type === options.channel_type);
    }
    if (options?.status) {
      list = list.filter((c) => c.status === options.status);
    }
    if (options?.priority) {
      list = list.filter((c) => c.priority === options.priority);
    }
    if (options?.assigned_user_id) {
      list = list.filter((c) => c.assigned_user_id === options.assigned_user_id);
    }
    if (options?.assigned_team_id) {
      list = list.filter((c) => c.assigned_team_id === options.assigned_team_id);
    }
    if (options?.unread_only) {
      list = list.filter((c) => c.unread_count > 0);
    }
    if (options?.tag) {
      list = list.filter((c) => c.tags.includes(options.tag!));
    }
    if (options?.search) {
      const q = options.search.toLowerCase();
      list = list.filter((c) => {
        const customer = this.findCustomerById(tenantId, c.customer_id);
        const nameMatch = customer ? `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(q) : false;
        const phoneMatch = customer?.phone?.toLowerCase().includes(q) || false;
        const subjectMatch = c.subject?.toLowerCase().includes(q) || false;
        const idMatch = c.id.toLowerCase().includes(q) || c.external_conversation_id.toLowerCase().includes(q);
        return nameMatch || phoneMatch || subjectMatch || idMatch;
      });
    }

    // Sort by last_message_at desc
    list.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

    const total = list.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    const paged = list.slice(offset, offset + limit);

    const enriched = paged.map((c) => {
      const customer = this.findCustomerById(tenantId, c.customer_id);
      const channel = this.findConnectedChannelById(tenantId, c.channel_id);
      return {
        ...c,
        customer,
        channel_name: channel?.name || c.channel_type,
      };
    });

    return { conversations: enriched, total };
  }

  public findConversationById(tenantId: string, id: string): Conversation | undefined {
    return this.data.conversations.find((c) => c.tenant_id === tenantId && c.id === id);
  }

  public findConversationByExternalId(tenantId: string, channelId: string, externalConversationId: string): Conversation | undefined {
    return this.data.conversations.find(
      (c) => c.tenant_id === tenantId && c.channel_id === channelId && c.external_conversation_id === externalConversationId
    );
  }

  public createConversation(conversation: Conversation): Conversation {
    this.data.conversations.push(conversation);
    this.persist();
    return conversation;
  }

  public updateConversation(tenantId: string, id: string, patch: Partial<Conversation>): Conversation {
    const idx = this.data.conversations.findIndex((c) => c.tenant_id === tenantId && c.id === id);
    if (idx === -1) {
      throw new Error(`Conversation '${id}' not found for tenant '${tenantId}'`);
    }
    const updated = {
      ...this.data.conversations[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.data.conversations[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== SOCIAL COMMERCE: MESSAGES ====================
  /** Every message in every conversation of one customer (FX-22): frequency caps must count all of them. */
  public getCustomerMessages(tenantId: string, customerId: string): Message[] {
    const conversationIds = new Set(
      this.data.conversations.filter((c) => c.tenant_id === tenantId && c.customer_id === customerId).map((c) => c.id)
    );
    if (conversationIds.size === 0) return [];
    return this.data.messages.filter((m) => m.tenant_id === tenantId && conversationIds.has(m.conversation_id));
  }

  public getMessages(
    tenantId: string,
    conversationId: string,
    options?: {
      cursor?: string;
      limit?: number;
      direction?: "before" | "after";
    }
  ): { messages: Message[]; nextCursor?: string; prevCursor?: string; total: number } {
    let list = this.data.messages.filter(
      (m) => m.tenant_id === tenantId && m.conversation_id === conversationId
    );

    // Sort chronologically ascending
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const total = list.length;

    const limit = options?.limit || 50;
    if (!options?.cursor) {
      // Return the most recent messages (last 'limit' entries)
      const start = Math.max(0, list.length - limit);
      const slice = list.slice(start);
      const prevCursor = start > 0 ? slice[0]?.id : undefined;
      return { messages: slice, prevCursor, total };
    }

    const cursorIdx = list.findIndex((m) => m.id === options.cursor);
    if (cursorIdx === -1) {
      return { messages: list.slice(-limit), total };
    }

    if (options.direction === "after") {
      const slice = list.slice(cursorIdx + 1, cursorIdx + 1 + limit);
      const nextCursor = cursorIdx + 1 + limit < list.length ? slice[slice.length - 1]?.id : undefined;
      return { messages: slice, nextCursor, total };
    } else {
      const start = Math.max(0, cursorIdx - limit);
      const slice = list.slice(start, cursorIdx);
      const prevCursor = start > 0 ? slice[0]?.id : undefined;
      return { messages: slice, prevCursor, total };
    }
  }

  public findMessageById(tenantId: string, id: string): Message | undefined {
    return this.data.messages.find((m) => m.tenant_id === tenantId && m.id === id);
  }

  public findMessageByExternalId(tenantId: string, channelId: string, externalMessageId: string): Message | undefined {
    // External message id is unique per channel
    return this.data.messages.find(
      (m) => m.tenant_id === tenantId && m.external_message_id === externalMessageId
    );
  }

  public findMessageByIdempotencyKey(tenantId: string, idempotencyKey: string): Message | undefined {
    return this.data.messages.find(
      (m) => m.tenant_id === tenantId && (m.idempotency_key === idempotencyKey || m.client_message_id === idempotencyKey)
    );
  }

  public createMessage(message: Message): Message {
    // Idempotency guard: if external_message_id already exists in this tenant, return existing
    if (message.external_message_id) {
      const existing = this.findMessageByExternalId(message.tenant_id, "", message.external_message_id);
      if (existing) return existing;
    }
    if (message.idempotency_key) {
      const existing = this.findMessageByIdempotencyKey(message.tenant_id, message.idempotency_key);
      if (existing) return existing;
    }

    this.data.messages.push(message);
    this.persist();
    return message;
  }

  public updateMessage(tenantId: string, id: string, patch: Partial<Message>): Message {
    const idx = this.data.messages.findIndex((m) => m.tenant_id === tenantId && m.id === id);
    if (idx === -1) {
      throw new Error(`Message '${id}' not found for tenant '${tenantId}'`);
    }
    const updated = {
      ...this.data.messages[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.data.messages[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== SOCIAL COMMERCE: ASSIGNMENTS & TAGS ====================
  public createAssignment(assignment: ConversationAssignment): ConversationAssignment {
    this.data.conversation_assignments.push(assignment);
    this.persist();
    return assignment;
  }

  public getAssignmentHistory(tenantId: string, conversationId: string): ConversationAssignment[] {
    return this.data.conversation_assignments
      .filter((a) => a.tenant_id === tenantId && a.conversation_id === conversationId)
      .sort((a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime());
  }

  public getConversationTags(tenantId: string): ConversationTag[] {
    return this.data.conversation_tags.filter((t) => t.tenant_id === tenantId);
  }

  public createConversationTag(tag: ConversationTag): ConversationTag {
    const exists = this.data.conversation_tags.find(
      (t) => t.tenant_id === tag.tenant_id && t.name.toLowerCase() === tag.name.toLowerCase()
    );
    if (exists) return exists;
    this.data.conversation_tags.push(tag);
    this.persist();
    return tag;
  }

  // ==================== SOCIAL COMMERCE: LEADS ====================
  public getLeads(
    tenantId: string,
    options?: { status?: string; assigned_to?: string; limit?: number; offset?: number }
  ): { leads: (Lead & { customer?: Customer })[]; total: number } {
    let list = this.data.leads.filter((l) => l.tenant_id === tenantId);
    if (options?.status) {
      list = list.filter((l) => l.status === options.status);
    }
    if (options?.assigned_to) {
      list = list.filter((l) => l.assigned_to === options.assigned_to);
    }
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const total = list.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    const paged = list.slice(offset, offset + limit);

    const enriched = paged.map((lead) => ({
      ...lead,
      customer: this.findCustomerById(tenantId, lead.customer_id),
    }));

    return { leads: enriched, total };
  }

  public findLeadById(tenantId: string, id: string): Lead | undefined {
    return this.data.leads.find((l) => l.tenant_id === tenantId && l.id === id);
  }

  public findLeadByConversationId(tenantId: string, conversationId: string): Lead | undefined {
    return this.data.leads.find((l) => l.tenant_id === tenantId && l.conversation_id === conversationId);
  }

  public createLead(lead: Lead): Lead {
    this.data.leads.push(lead);
    this.persist();
    return lead;
  }

  public updateLead(tenantId: string, id: string, patch: Partial<Lead>): Lead {
    const idx = this.data.leads.findIndex((l) => l.tenant_id === tenantId && l.id === id);
    if (idx === -1) {
      throw new Error(`Lead '${id}' not found for tenant '${tenantId}'`);
    }
    const updated = {
      ...this.data.leads[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.data.leads[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== SOCIAL COMMERCE: QUICK REPLIES & BUSINESS HOURS ====================
  public getQuickReplies(tenantId: string, category?: string): QuickReply[] {
    return this.data.quick_replies.filter((qr) => {
      if (qr.tenant_id !== tenantId) return false;
      if (category && qr.category !== category) return false;
      return true;
    });
  }

  public createQuickReply(reply: QuickReply): QuickReply {
    this.data.quick_replies.push(reply);
    this.persist();
    return reply;
  }

  public deleteQuickReply(tenantId: string, id: string): boolean {
    const initialLen = this.data.quick_replies.length;
    this.data.quick_replies = this.data.quick_replies.filter(
      (qr) => !(qr.tenant_id === tenantId && qr.id === id)
    );
    const deleted = this.data.quick_replies.length < initialLen;
    if (deleted) this.persist();
    return deleted;
  }

  public getBusinessHours(tenantId: string): BusinessHours | undefined {
    return this.data.business_hours.find((bh) => bh.tenant_id === tenantId);
  }

  public setBusinessHours(hours: BusinessHours): BusinessHours {
    const idx = this.data.business_hours.findIndex((bh) => bh.tenant_id === hours.tenant_id);
    if (idx >= 0) {
      this.data.business_hours[idx] = {
        ...hours,
        updated_at: new Date().toISOString(),
      };
    } else {
      this.data.business_hours.push(hours);
    }
    this.persist();
    return hours;
  }

  // ==================== SOCIAL COMMERCE: CHAT SESSIONS ====================
  public createChatSession(session: ChatSession): ChatSession {
    this.data.chat_sessions.push(session);
    this.persist();
    return session;
  }

  public findChatSessionByAnonymousId(tenantId: string, anonymousId: string): ChatSession | undefined {
    return this.data.chat_sessions.find(
      (cs) => cs.tenant_id === tenantId && cs.anonymous_id === anonymousId
    );
  }

  public updateChatSession(tenantId: string, id: string, patch: Partial<ChatSession>): ChatSession {
    const idx = this.data.chat_sessions.findIndex((cs) => cs.tenant_id === tenantId && cs.id === id);
    if (idx === -1) {
      throw new Error(`Chat session '${id}' not found`);
    }
    const updated = {
      ...this.data.chat_sessions[idx],
      ...safePatch(patch),
      last_seen_at: new Date().toISOString(),
    };
    this.data.chat_sessions[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== OUTBOUND WEBHOOK DELIVERIES ====================
  public recordOutboundDelivery(delivery: OutboundWebhookDelivery): OutboundWebhookDelivery {
    this.data.outbound_webhook_deliveries.push(delivery);
    this.persist();
    return delivery;
  }

  public updateOutboundDelivery(tenantId: string, id: string, patch: Partial<OutboundWebhookDelivery>): OutboundWebhookDelivery {
    const idx = this.data.outbound_webhook_deliveries.findIndex(
      (d) => d.tenant_id === tenantId && d.id === id
    );
    if (idx >= 0) {
      this.data.outbound_webhook_deliveries[idx] = {
        ...this.data.outbound_webhook_deliveries[idx],
        ...safePatch(patch),
      };
      this.persist();
      return this.data.outbound_webhook_deliveries[idx];
    }
    throw new Error(`Outbound delivery '${id}' not found for tenant '${tenantId}'`);
  }

  public getOutboundDeliveries(tenantId: string, limit = 50): OutboundWebhookDelivery[] {
    return this.data.outbound_webhook_deliveries
      .filter((d) => d.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // ==================== SOCIAL DASHBOARD KPI AGGREGATION ====================
  public getSocialDashboardMetrics(tenantId: string): {
    totalConversations: number;
    unreadConversations: number;
    openConversations: number;
    resolvedConversations: number;
    totalLeads: number;
    convertedLeads: number;
    messagesReceivedToday: number;
    messagesSentToday: number;
    channelHealth: Record<string, { status: string; lastActivity?: string; messageCount: number }>;
  } {
    const tenantConvos = this.data.conversations.filter((c) => c.tenant_id === tenantId);
    const tenantMsgs = this.data.messages.filter((m) => m.tenant_id === tenantId);
    const tenantLeads = this.data.leads.filter((l) => l.tenant_id === tenantId);
    const tenantChannels = this.data.connected_channels.filter((c) => c.tenant_id === tenantId);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let messagesReceivedToday = 0;
    let messagesSentToday = 0;

    for (const msg of tenantMsgs) {
      const msgTime = new Date(msg.created_at).getTime();
      if (msgTime >= startOfDay) {
        if (msg.direction === "INBOUND") messagesReceivedToday++;
        if (msg.direction === "OUTBOUND") messagesSentToday++;
      }
    }

    const channelHealth: Record<string, { status: string; lastActivity?: string; messageCount: number }> = {};
    for (const ch of tenantChannels) {
      const chMsgs = tenantMsgs.filter((m) => {
        const convo = tenantConvos.find((c) => c.id === m.conversation_id);
        return convo?.channel_id === ch.id;
      });
      channelHealth[ch.type] = {
        status: ch.status,
        lastActivity: ch.last_webhook_at || ch.last_sync_at,
        messageCount: chMsgs.length,
      };
    }

    return {
      totalConversations: tenantConvos.length,
      unreadConversations: tenantConvos.filter((c) => c.unread_count > 0).length,
      openConversations: tenantConvos.filter((c) => c.status === "OPEN" || c.status === "WAITING_AGENT").length,
      resolvedConversations: tenantConvos.filter((c) => c.status === "RESOLVED" || c.status === "CLOSED").length,
      totalLeads: tenantLeads.length,
      convertedLeads: tenantLeads.filter((l) => l.status === "CONVERTED").length,
      messagesReceivedToday,
      messagesSentToday,
      channelHealth,
    };
  }

  // ==================== PHASE 4: AGENTIC AI & KNOWLEDGE ====================

  // Agents
  public getAgents(tenantId: string): AgentDefinition[] {
    return this.data.agents.filter((a) => a.tenant_id === tenantId);
  }

  public findAgentById(tenantId: string, id: string): AgentDefinition | undefined {
    return this.data.agents.find((a) => a.tenant_id === tenantId && a.id === id);
  }

  public findAgentByType(tenantId: string, agentType: AgentType): AgentDefinition | undefined {
    return this.data.agents.find((a) => a.tenant_id === tenantId && a.agent_type === agentType);
  }

  public createAgent(agent: AgentDefinition): AgentDefinition {
    this.data.agents.push(agent);
    this.persist();
    return agent;
  }

  public updateAgent(
    tenantId: string,
    id: string,
    patch: Partial<AgentDefinition>
  ): AgentDefinition | undefined {
    const idx = this.data.agents.findIndex((a) => a.tenant_id === tenantId && a.id === id);
    if (idx === -1) return undefined;
    this.data.agents[idx] = {
      ...this.data.agents[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.agents[idx];
  }

  // Tenant AI Policy
  public getAIPolicy(tenantId: string): TenantAIPolicy {
    let policy = this.data.agent_policies.find((p) => p.tenant_id === tenantId);
    if (!policy) {
      policy = {
        id: `pol_${tenantId}`,
        tenant_id: tenantId,
        ai_mode: "AI_COPILOT",
        is_enabled: true,
        autonomous_sales_enabled: false,
        autonomous_support_enabled: false,
        autonomous_order_enabled: false,
        debounce_window_ms: 3000,
        confidence_threshold_high: 0.85,
        confidence_threshold_low: 0.60,
        max_iterations_per_run: 5,
        max_tool_calls_per_run: 6,
        max_tokens_per_run: 2000,
        daily_cost_budget_usd: 10.0,
        monthly_cost_budget_usd: 150.0,
        pii_redaction_enabled: true,
        allowed_channel_types: ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"],
        disallowed_tool_names: [],
        human_handoff_reasons: [
          "CUSTOMER_REQUESTED",
          "LOW_CONFIDENCE",
          "PAYMENT_DISPUTE",
          "COMPLAINT",
          "HIGH_RISK_ACTION",
        ],
        updated_at: new Date().toISOString(),
      };
      // Default returned, not stored: reads never write (FX-21). setAIPolicy stores it on the first explicit update.
    }
    return policy;
  }

  public setAIPolicy(policy: TenantAIPolicy): TenantAIPolicy {
    const idx = this.data.agent_policies.findIndex((p) => p.tenant_id === policy.tenant_id);
    if (idx === -1) {
      this.data.agent_policies.push(policy);
    } else {
      this.data.agent_policies[idx] = {
        ...policy,
        updated_at: new Date().toISOString(),
      };
    }
    this.persist();
    return policy;
  }

  // Agent Runs
  public getAgentRuns(
    tenantId: string,
    options?: {
      conversation_id?: string;
      agent_type?: string;
      status?: string;
      limit?: number;
    }
  ): AgentRun[] {
    return this.data.agent_runs
      .filter((r) => {
        if (r.tenant_id !== tenantId) return false;
        if (options?.conversation_id && r.conversation_id !== options.conversation_id) return false;
        if (options?.agent_type && r.agent_type !== options.agent_type) return false;
        if (options?.status && r.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, options?.limit || 50);
  }

  public findAgentRunById(tenantId: string, id: string): AgentRun | undefined {
    return this.data.agent_runs.find((r) => r.tenant_id === tenantId && r.id === id);
  }

  public createAgentRun(run: AgentRun): AgentRun {
    this.data.agent_runs.push(run);
    this.persist();
    return run;
  }

  public updateAgentRun(
    tenantId: string,
    id: string,
    patch: Partial<AgentRun>
  ): AgentRun | undefined {
    const idx = this.data.agent_runs.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) return undefined;
    this.data.agent_runs[idx] = {
      ...this.data.agent_runs[idx],
      ...safePatch(patch),
    };
    this.persist();
    return this.data.agent_runs[idx];
  }

  // Agent Tool Calls
  public getAgentToolCalls(tenantId: string, runId: string): AgentToolCallRecord[] {
    return this.data.agent_tool_calls.filter(
      (t) => t.tenant_id === tenantId && t.agent_run_id === runId
    );
  }

  public createAgentToolCall(record: AgentToolCallRecord): AgentToolCallRecord {
    this.data.agent_tool_calls.push(record);
    this.persist();
    return record;
  }

  // Prompts & Versions
  public getPrompts(tenantId: string): AgentPrompt[] {
    return this.data.agent_prompts.filter((p) => p.tenant_id === tenantId);
  }

  public findPromptByType(tenantId: string, agentType: AgentType): AgentPrompt | undefined {
    return this.data.agent_prompts.find(
      (p) => p.tenant_id === tenantId && p.agent_type === agentType
    );
  }

  public createPrompt(prompt: AgentPrompt): AgentPrompt {
    this.data.agent_prompts.push(prompt);
    this.persist();
    return prompt;
  }

  public getPromptVersions(tenantId: string, promptId: string): PromptVersion[] {
    return this.data.prompt_versions.filter(
      (v) => v.tenant_id === tenantId && v.prompt_id === promptId
    );
  }

  public findActivePromptVersion(tenantId: string, promptId: string): PromptVersion | undefined {
    return this.data.prompt_versions.find(
      (v) => v.tenant_id === tenantId && v.prompt_id === promptId && v.is_active
    );
  }

  public createPromptVersion(version: PromptVersion): PromptVersion {
    if (version.is_active) {
      // Deactivate other versions for this prompt
      for (const v of this.data.prompt_versions) {
        if (v.tenant_id === version.tenant_id && v.prompt_id === version.prompt_id) {
          v.is_active = false;
        }
      }
    }
    this.data.prompt_versions.push(version);
    this.persist();
    return version;
  }

  // Conversation Summaries
  public getConversationSummary(
    tenantId: string,
    conversationId: string
  ): ConversationSummary | undefined {
    return this.data.conversation_summaries.find(
      (s) => s.tenant_id === tenantId && s.conversation_id === conversationId
    );
  }

  public saveConversationSummary(summary: ConversationSummary): ConversationSummary {
    const idx = this.data.conversation_summaries.findIndex(
      (s) => s.tenant_id === summary.tenant_id && s.conversation_id === summary.conversation_id
    );
    if (idx === -1) {
      this.data.conversation_summaries.push(summary);
    } else {
      this.data.conversation_summaries[idx] = summary;
    }
    this.persist();
    return summary;
  }

  // Customer Memory
  public getCustomerMemory(tenantId: string, customerId: string): CustomerMemory | undefined {
    return this.data.customer_memories.find(
      (m) => m.tenant_id === tenantId && m.customer_id === customerId
    );
  }

  public saveCustomerMemory(memory: CustomerMemory): CustomerMemory {
    const idx = this.data.customer_memories.findIndex(
      (m) => m.tenant_id === memory.tenant_id && m.customer_id === memory.customer_id
    );
    if (idx === -1) {
      this.data.customer_memories.push(memory);
    } else {
      this.data.customer_memories[idx] = memory;
    }
    this.persist();
    return memory;
  }

  // Knowledge Documents & Chunks
  public getKnowledgeDocuments(
    tenantId: string,
    options?: { document_type?: string; status?: string }
  ): KnowledgeDocument[] {
    return this.data.knowledge_documents
      .filter((d) => {
        if (d.tenant_id !== tenantId) return false;
        if (options?.document_type && d.document_type !== options.document_type) return false;
        if (options?.status && d.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public findKnowledgeDocumentById(tenantId: string, id: string): KnowledgeDocument | undefined {
    return this.data.knowledge_documents.find((d) => d.tenant_id === tenantId && d.id === id);
  }

  public createKnowledgeDocument(doc: KnowledgeDocument): KnowledgeDocument {
    this.data.knowledge_documents.push(doc);
    this.persist();
    return doc;
  }

  public updateKnowledgeDocument(
    tenantId: string,
    id: string,
    patch: Partial<KnowledgeDocument>
  ): KnowledgeDocument | undefined {
    const idx = this.data.knowledge_documents.findIndex(
      (d) => d.tenant_id === tenantId && d.id === id
    );
    if (idx === -1) return undefined;
    this.data.knowledge_documents[idx] = {
      ...this.data.knowledge_documents[idx],
      ...safePatch(patch),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.knowledge_documents[idx];
  }

  public deleteKnowledgeDocument(tenantId: string, id: string): boolean {
    const initialLen = this.data.knowledge_documents.length;
    this.data.knowledge_documents = this.data.knowledge_documents.filter(
      (d) => !(d.tenant_id === tenantId && d.id === id)
    );
    this.data.knowledge_chunks = this.data.knowledge_chunks.filter(
      (c) => !(c.tenant_id === tenantId && c.document_id === id)
    );
    this.persist();
    return this.data.knowledge_documents.length < initialLen;
  }

  public getKnowledgeChunks(tenantId: string, documentId: string): KnowledgeChunk[] {
    return this.data.knowledge_chunks.filter(
      (c) => c.tenant_id === tenantId && c.document_id === documentId
    );
  }

  public saveKnowledgeChunks(
    tenantId: string,
    documentId: string,
    chunks: KnowledgeChunk[]
  ): KnowledgeChunk[] {
    // Remove existing chunks for this document
    this.data.knowledge_chunks = this.data.knowledge_chunks.filter(
      (c) => !(c.tenant_id === tenantId && c.document_id === documentId)
    );
    this.data.knowledge_chunks.push(...chunks);
    this.persist();
    return chunks;
  }

  public findKnowledgeChunkById(tenantId: string, chunkId: string): KnowledgeChunk | undefined {
    return this.data.knowledge_chunks.find(
      (c) => c.tenant_id === tenantId && c.id === chunkId
    );
  }

  public findParentKnowledgeChunk(tenantId: string, parentChunkId: string): KnowledgeChunk | undefined {
    return this.data.knowledge_chunks.find(
      (c) => c.tenant_id === tenantId && c.id === parentChunkId && c.chunk_type === "PARENT"
    );
  }

  public getChildKnowledgeChunks(tenantId: string, parentChunkId: string): KnowledgeChunk[] {
    return this.data.knowledge_chunks.filter(
      (c) => c.tenant_id === tenantId && c.parent_chunk_id === parentChunkId
    );
  }

  public getAllTenantKnowledgeChunks(tenantId: string, chunkType?: "PARENT" | "CHILD" | "STANDARD"): KnowledgeChunk[] {
    return this.data.knowledge_chunks.filter(
      (c) => c.tenant_id === tenantId && (!chunkType || c.chunk_type === chunkType)
    );
  }

  public searchKnowledgeChunks(
    tenantId: string,
    queryEmbedding: number[],
    topK: number = 4,
    minScore: number = 0.65,
    options?: { chunkType?: "PARENT" | "CHILD" | "STANDARD"; excludeParents?: boolean }
  ): Array<KnowledgeChunk & { similarity: number }> {
    // Cosine similarity search strictly tenant-isolated
    let tenantChunks = this.data.knowledge_chunks.filter((c) => c.tenant_id === tenantId);
    if (options?.excludeParents) {
      tenantChunks = tenantChunks.filter((c) => c.chunk_type !== "PARENT");
    } else if (options?.chunkType) {
      tenantChunks = tenantChunks.filter((c) => c.chunk_type === options.chunkType);
    }

    if (tenantChunks.length === 0 || queryEmbedding.length === 0) return [];

    const scored = tenantChunks
      .map((chunk) => {
        const similarity = this.computeCosineSimilarity(queryEmbedding, chunk.embedding);
        return {
          ...chunk,
          similarity,
        };
      })
      .filter((c) => c.similarity >= minScore)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return scored;
  }

  private computeCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // AI Traces
  public getAITraces(tenantId: string, runId?: string): AITrace[] {
    return this.data.ai_traces.filter((t) => {
      if (t.tenant_id !== tenantId) return false;
      if (runId && t.agent_run_id !== runId) return false;
      return true;
    });
  }

  public createAITrace(trace: AITrace): AITrace {
    this.data.ai_traces.push(trace);
    this.persist();
    return trace;
  }

  // AI Usage
  public getAIUsage(
    tenantId: string,
    options?: { agent_type?: string; since?: string }
  ): AIUsageRecord[] {
    return this.data.ai_usage.filter((u) => {
      if (u.tenant_id !== tenantId) return false;
      if (options?.agent_type && u.agent_type !== options.agent_type) return false;
      if (options?.since && new Date(u.timestamp) < new Date(options.since)) return false;
      return true;
    });
  }

  public recordAIUsage(usage: AIUsageRecord): AIUsageRecord {
    this.data.ai_usage.push(usage);
    this.persist();
    return usage;
  }

  // AI Feedback
  public getAIFeedback(
    tenantId: string,
    options?: { runId?: string; rating?: string }
  ): AIFeedbackRecord[] {
    return this.data.ai_feedback.filter((f) => {
      if (f.tenant_id !== tenantId) return false;
      if (options?.runId && f.agent_run_id !== options.runId) return false;
      if (options?.rating && f.rating !== options.rating) return false;
      return true;
    });
  }

  public createAIFeedback(feedback: AIFeedbackRecord): AIFeedbackRecord {
    this.data.ai_feedback.push(feedback);
    this.persist();
    return feedback;
  }

  // Real-time AI Dashboard KPI Aggregation
  public getAIDashboardMetrics(tenantId: string) {
    const tenantRuns = this.data.agent_runs.filter((r) => r.tenant_id === tenantId);
    const tenantTools = this.data.agent_tool_calls.filter((t) => t.tenant_id === tenantId);
    const tenantDocs = this.data.knowledge_documents.filter(
      (d) => d.tenant_id === tenantId && d.status === "ACTIVE"
    );
    const tenantFeedback = this.data.ai_feedback.filter((f) => f.tenant_id === tenantId);

    const completedRuns = tenantRuns.filter((r) => r.status === "COMPLETED");
    const escalatedRuns = tenantRuns.filter((r) => r.status === "ESCALATED");
    const failedRuns = tenantRuns.filter((r) => r.status === "FAILED");

    const totalCostUsd = tenantRuns.reduce((acc, r) => acc + (r.estimated_cost_usd || 0), 0);
    const totalCostBdt = tenantRuns.reduce((acc, r) => acc + (r.estimated_cost_bdt || 0), 0);

    const avgLatencyMs =
      completedRuns.length > 0
        ? Math.round(
            completedRuns.reduce((acc, r) => acc + r.latency_ms, 0) / completedRuns.length
          )
        : 0;

    const resolutionRate =
      tenantRuns.length > 0
        ? Math.round(((completedRuns.length) / tenantRuns.length) * 100)
        : 100;

    const recentHandoffs = escalatedRuns
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        conversation_id: r.conversation_id,
        agent_type: r.agent_type,
        reason: r.error_message || "Human handoff requested",
        timestamp: r.created_at,
      }));

    return {
      totalAIConversations: new Set(tenantRuns.map((r) => r.conversation_id)).size,
      totalRuns: tenantRuns.length,
      aiResolutionRate: resolutionRate,
      totalHandoffs: escalatedRuns.length,
      totalToolCalls: tenantTools.length,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      totalCostBdt: Number(totalCostBdt.toFixed(2)),
      averageLatencyMs: avgLatencyMs,
      errorCount: failedRuns.length,
      activeAgentsCount: this.getAgents(tenantId).filter((a) => a.status === "ACTIVE").length,
      knowledgeDocumentsCount: tenantDocs.length,
      feedbackStats: {
        total: tenantFeedback.length,
        helpful: tenantFeedback.filter((f) => f.rating === "HELPFUL").length,
        wrong: tenantFeedback.filter((f) => f.rating === "WRONG").length,
      },
      recentHandoffs,
    };
  }

  // ============================================================
  // PHASE 5: MULTI-AGENT ORCHESTRATION REPOSITORIES
  // ============================================================

  // --- Workflows ---
  public getWorkflows(tenantId: string, status?: string): AgentWorkflow[] {
    return this.data.workflows
      .filter((w) => w.tenant_id === tenantId && (!status || w.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getWorkflowById(tenantId: string, id: string): AgentWorkflow | undefined {
    return this.data.workflows.find((w) => w.tenant_id === tenantId && w.id === id);
  }

  public insertWorkflow(workflow: AgentWorkflow): AgentWorkflow {
    this.data.workflows.push(workflow);
    this.persist();
    return workflow;
  }

  public updateWorkflow(tenantId: string, id: string, updates: Partial<AgentWorkflow>): AgentWorkflow {
    const idx = this.data.workflows.findIndex((w) => w.tenant_id === tenantId && w.id === id);
    if (idx === -1) throw new Error(`Workflow not found: ${id}`);
    const updated: AgentWorkflow = {
      ...this.data.workflows[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.data.workflows[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Tasks ---
  public getTasks(tenantId: string, workflowId?: string): AgentTask[] {
    return this.data.tasks.filter(
      (t) => t.tenant_id === tenantId && (!workflowId || t.workflow_id === workflowId)
    );
  }

  public getTaskById(tenantId: string, id: string): AgentTask | undefined {
    return this.data.tasks.find((t) => t.tenant_id === tenantId && t.id === id);
  }

  public insertTask(task: AgentTask): AgentTask {
    this.data.tasks.push(task);
    this.persist();
    return task;
  }

  public updateTask(tenantId: string, id: string, updates: Partial<AgentTask>): AgentTask {
    const idx = this.data.tasks.findIndex((t) => t.tenant_id === tenantId && t.id === id);
    if (idx === -1) throw new Error(`Task not found: ${id}`);
    const updated: AgentTask = {
      ...this.data.tasks[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.data.tasks[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Agent Messages ---
  public getAgentMessages(tenantId: string, workflowId?: string): AgentMessage[] {
    return this.data.agent_messages.filter(
      (m) => m.tenant_id === tenantId && (!workflowId || m.workflow_id === workflowId)
    );
  }

  public insertAgentMessage(message: AgentMessage): AgentMessage {
    this.data.agent_messages.push(message);
    this.persist();
    return message;
  }

  // --- Workflow Contexts ---
  public getWorkflowContext(tenantId: string, workflowId: string): WorkflowContext | undefined {
    return this.data.workflow_contexts.find((c) => c.tenant_id === tenantId && c.workflow_id === workflowId);
  }

  public upsertWorkflowContext(context: WorkflowContext): WorkflowContext {
    const idx = this.data.workflow_contexts.findIndex((c) => c.workflow_id === context.workflow_id);
    if (idx >= 0) {
      this.data.workflow_contexts[idx] = {
        ...this.data.workflow_contexts[idx],
        ...context,
        updated_at: new Date().toISOString(),
      };
    } else {
      this.data.workflow_contexts.push(context);
    }
    this.persist();
    return context;
  }

  // --- Workflow Artifacts ---
  public getWorkflowArtifacts(tenantId: string, workflowId: string): WorkflowArtifact[] {
    return this.data.workflow_artifacts.filter((a) => a.tenant_id === tenantId && a.workflow_id === workflowId);
  }

  public insertWorkflowArtifact(artifact: WorkflowArtifact): WorkflowArtifact {
    this.data.workflow_artifacts.push(artifact);
    this.persist();
    return artifact;
  }

  // --- Checkpoints ---
  public getWorkflowCheckpoints(tenantId: string, workflowId: string): WorkflowCheckpoint[] {
    return this.data.workflow_checkpoints
      .filter((c) => c.tenant_id === tenantId && c.workflow_id === workflowId)
      .sort((a, b) => b.step_index - a.step_index);
  }

  public insertWorkflowCheckpoint(checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
    this.data.workflow_checkpoints.push(checkpoint);
    this.persist();
    return checkpoint;
  }

  // --- Delegations ---
  public getAgentDelegations(tenantId: string, workflowId: string): AgentDelegation[] {
    return this.data.agent_delegations.filter((d) => d.tenant_id === tenantId && d.workflow_id === workflowId);
  }

  public insertAgentDelegation(delegation: AgentDelegation): AgentDelegation {
    this.data.agent_delegations.push(delegation);
    this.persist();
    return delegation;
  }

  public updateAgentDelegation(tenantId: string, id: string, updates: Partial<AgentDelegation>): AgentDelegation {
    const idx = this.data.agent_delegations.findIndex((d) => d.tenant_id === tenantId && d.id === id);
    if (idx === -1) throw new Error(`Delegation not found: ${id}`);
    const updated = { ...this.data.agent_delegations[idx], ...safePatch(updates) };
    this.data.agent_delegations[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Verifications ---
  public getAgentVerifications(tenantId: string, taskId: string): AgentVerification[] {
    return this.data.agent_verifications.filter((v) => v.tenant_id === tenantId && v.task_id === taskId);
  }

  public getAgentVerificationsByTenant(tenantId: string): AgentVerification[] {
    return this.data.agent_verifications.filter((v) => v.tenant_id === tenantId);
  }

  public insertAgentVerification(verification: AgentVerification): AgentVerification {
    this.data.agent_verifications.push(verification);
    this.persist();
    return verification;
  }

  // --- Approvals ---
  public getApprovalRequests(tenantId: string, status?: string): ApprovalRequest[] {
    return this.data.approval_requests
      .filter((a) => a.tenant_id === tenantId && (!status || a.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getApprovalRequestById(tenantId: string, id: string): ApprovalRequest | undefined {
    return this.data.approval_requests.find((a) => a.tenant_id === tenantId && a.id === id);
  }

  public getApprovalRequest(tenantId: string, id: string): ApprovalRequest | undefined {
    return this.getApprovalRequestById(tenantId, id);
  }

  public insertApprovalRequest(req: ApprovalRequest): ApprovalRequest {
    this.data.approval_requests.push(req);
    this.persist();
    return req;
  }

  public updateApprovalRequest(tenantId: string, id: string, updates: Partial<ApprovalRequest>): ApprovalRequest {
    const idx = this.data.approval_requests.findIndex((a) => a.tenant_id === tenantId && a.id === id);
    if (idx === -1) throw new Error(`ApprovalRequest not found: ${id}`);
    const updated = { ...this.data.approval_requests[idx], ...safePatch(updates) };
    this.data.approval_requests[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Autonomy Policies ---
  public getAutonomyPolicies(tenantId: string): AutonomyPolicy[] {
    return this.data.autonomy_policies.filter((p) => p.tenant_id === tenantId);
  }

  public getAutonomyPolicy(tenantId: string, agentType: string): AutonomyPolicy | undefined {
    return this.data.autonomy_policies.find(
      (p) => p.tenant_id === tenantId && p.agent_type === agentType
    );
  }

  /** The tenant is a separate argument and always wins over any tenant_id inside the record (review fix). */
  public upsertAutonomyPolicy(tenantId: string, input: AutonomyPolicy): AutonomyPolicy {
    const policy: AutonomyPolicy = { ...input, tenant_id: tenantId };
    const idx = this.data.autonomy_policies.findIndex(
      (p) => p.tenant_id === tenantId && p.agent_type === policy.agent_type
    );
    if (idx >= 0) {
      this.data.autonomy_policies[idx] = {
        ...this.data.autonomy_policies[idx],
        ...policy,
        updated_at: new Date().toISOString(),
      };
    } else {
      this.data.autonomy_policies.push(policy);
    }
    this.persist();
    return policy;
  }

  // --- Workflow Templates ---
  public getWorkflowTemplates(tenantId: string): WorkflowTemplate[] {
    return this.data.workflow_templates.filter(
      (t) => t.tenant_id === tenantId || t.tenant_id === "GLOBAL"
    );
  }

  public getWorkflowTemplateByCode(tenantId: string, code: string): WorkflowTemplate | undefined {
    return this.data.workflow_templates.find(
      (t) => (t.tenant_id === tenantId || t.tenant_id === "GLOBAL") && t.code === code
    );
  }

  public insertWorkflowTemplate(template: WorkflowTemplate): WorkflowTemplate {
    this.data.workflow_templates.push(template);
    this.persist();
    return template;
  }

  // --- Trigger Rules ---
  public getAgentTriggerRules(tenantId: string, eventType?: string): AgentTriggerRule[] {
    return this.data.trigger_rules.filter(
      (r) => r.tenant_id === tenantId && (!eventType || r.event_type === eventType)
    );
  }

  public insertAgentTriggerRule(rule: AgentTriggerRule): AgentTriggerRule {
    this.data.trigger_rules.push(rule);
    this.persist();
    return rule;
  }

  public updateAgentTriggerRule(tenantId: string, id: string, updates: Partial<AgentTriggerRule>): AgentTriggerRule {
    const idx = this.data.trigger_rules.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) throw new Error(`TriggerRule not found: ${id}`);
    const updated = {
      ...this.data.trigger_rules[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.data.trigger_rules[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Action Receipts ---
  public getActionReceipts(tenantId: string): ActionReceipt[] {
    return this.data.action_receipts.filter((r) => r.tenant_id === tenantId);
  }

  public getActionReceiptByIdempotencyKey(tenantId: string, key: string): ActionReceipt | undefined {
    return this.data.action_receipts.find(
      (r) => r.tenant_id === tenantId && r.idempotency_key === key
    );
  }

  public insertActionReceipt(receipt: ActionReceipt): ActionReceipt {
    this.data.action_receipts.push(receipt);
    this.persist();
    return receipt;
  }

  // --- Schedules ---
  public getAgentSchedules(tenantId: string): AgentSchedule[] {
    return this.data.agent_schedules.filter((s) => s.tenant_id === tenantId);
  }

  public insertAgentSchedule(schedule: AgentSchedule): AgentSchedule {
    this.data.agent_schedules.push(schedule);
    this.persist();
    return schedule;
  }

  public updateAgentSchedule(tenantId: string, id: string, updates: Partial<AgentSchedule>): AgentSchedule {
    const idx = this.data.agent_schedules.findIndex((s) => s.tenant_id === tenantId && s.id === id);
    if (idx === -1) throw new Error(`AgentSchedule not found: ${id}`);
    const updated = {
      ...this.data.agent_schedules[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.data.agent_schedules[idx] = updated;
    this.persist();
    return updated;
  }

  // ============================================================
  // PHASE 6: COMMERCE INTELLIGENCE, OPTIMIZATION & DECISION METHODS
  // ============================================================

  // --- Analytics Events ---
  public getAnalyticsEvents(tenantId: string): Array<{ id: string; tenant_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }> {
    return this.data.analytics_events.filter((e) => e.tenant_id === tenantId);
  }

  public insertAnalyticsEvent(event: { id: string; tenant_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }) {
    this.data.analytics_events.push(event);
    this.persist();
    return event;
  }

  // --- Metric Definitions ---
  public getMetricDefinitions(): MetricDefinition[] {
    return [...this.data.metric_definitions];
  }

  public getMetricDefinition(key: string): MetricDefinition | undefined {
    return this.data.metric_definitions.find((m) => m.key === key);
  }

  public upsertMetricDefinition(def: MetricDefinition): MetricDefinition {
    const idx = this.data.metric_definitions.findIndex((m) => m.key === def.key);
    if (idx !== -1) {
      this.data.metric_definitions[idx] = { ...this.data.metric_definitions[idx], ...def, updated_at: new Date().toISOString() };
    } else {
      this.data.metric_definitions.push(def);
    }
    this.persist();
    return def;
  }

  // --- Metric Snapshots ---
  public getMetricSnapshots(tenantId: string, metricKey?: string): MetricSnapshot[] {
    return this.data.metric_snapshots.filter(
      (s) => s.tenant_id === tenantId && (!metricKey || s.metric_key === metricKey)
    );
  }

  public insertMetricSnapshot(snapshot: MetricSnapshot): MetricSnapshot {
    this.data.metric_snapshots.push(snapshot);
    this.persist();
    return snapshot;
  }

  // --- Insights ---
  public getInsights(tenantId: string, status?: string): Insight[] {
    return this.data.insights
      .filter((i) => i.tenant_id === tenantId && (!status || i.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public insertInsight(insight: Insight): Insight {
    this.data.insights.push(insight);
    this.persist();
    return insight;
  }

  public updateInsight(tenantId: string, id: string, updates: Partial<Insight>): Insight {
    const idx = this.data.insights.findIndex((i) => i.tenant_id === tenantId && i.id === id);
    if (idx === -1) throw new Error(`Insight not found: ${id}`);
    const updated = { ...this.data.insights[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.insights[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Anomalies ---
  public getAnomalies(tenantId: string): Anomaly[] {
    return this.data.anomalies
      .filter((a) => a.tenant_id === tenantId)
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());
  }

  public insertAnomaly(anomaly: Anomaly): Anomaly {
    this.data.anomalies.push(anomaly);
    this.persist();
    return anomaly;
  }

  // --- Opportunities ---
  public getOpportunities(tenantId: string, status?: string): Opportunity[] {
    return this.data.opportunities
      .filter((o) => o.tenant_id === tenantId && (!status || o.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public insertOpportunity(opportunity: Opportunity): Opportunity {
    this.data.opportunities.push(opportunity);
    this.persist();
    return opportunity;
  }

  public updateOpportunity(tenantId: string, id: string, updates: Partial<Opportunity>): Opportunity {
    const idx = this.data.opportunities.findIndex((o) => o.tenant_id === tenantId && o.id === id);
    if (idx === -1) throw new Error(`Opportunity not found: ${id}`);
    const updated = { ...this.data.opportunities[idx], ...safePatch(updates) };
    this.data.opportunities[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Risks ---
  public getRisks(tenantId: string): Risk[] {
    return this.data.risks
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public insertRisk(risk: Risk): Risk {
    this.data.risks.push(risk);
    this.persist();
    return risk;
  }

  // --- Recommendations ---
  public getRecommendations(tenantId: string, status?: string): Recommendation[] {
    return this.data.recommendations
      .filter((r) => r.tenant_id === tenantId && (!status || r.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getRecommendationById(tenantId: string, id: string): Recommendation | undefined {
    return this.data.recommendations.find((r) => r.tenant_id === tenantId && r.id === id);
  }

  public insertRecommendation(rec: Recommendation): Recommendation {
    this.data.recommendations.push(rec);
    this.persist();
    return rec;
  }

  public updateRecommendation(tenantId: string, id: string, updates: Partial<Recommendation>): Recommendation {
    const idx = this.data.recommendations.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) throw new Error(`Recommendation not found: ${id}`);
    const updated = { ...this.data.recommendations[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.recommendations[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Forecasts ---
  public getForecastRuns(tenantId: string, targetType?: string): ForecastRun[] {
    return this.data.forecast_runs
      .filter((f) => f.tenant_id === tenantId && (!targetType || f.target_type === targetType))
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
  }

  public insertForecastRun(run: ForecastRun): ForecastRun {
    this.data.forecast_runs.push(run);
    this.persist();
    return run;
  }

  // --- Simulations ---
  public getSimulations(tenantId: string): SimulationResult[] {
    return this.data.simulations
      .filter((s) => s.tenant_id === tenantId)
      .sort((a, b) => new Date(b.simulated_at).getTime() - new Date(a.simulated_at).getTime());
  }

  public getSimulationById(tenantId: string, id: string): SimulationResult | undefined {
    return this.data.simulations.find((s) => s.tenant_id === tenantId && s.id === id);
  }

  public insertSimulation(sim: SimulationResult): SimulationResult {
    this.data.simulations.push(sim);
    this.persist();
    return sim;
  }

  // --- Decisions ---
  public getDecisionRequests(tenantId: string, status?: string): DecisionRequest[] {
    return this.data.decision_requests
      .filter((d) => d.tenant_id === tenantId && (!status || d.status === status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getDecisionRequestById(tenantId: string, id: string): DecisionRequest | undefined {
    return this.data.decision_requests.find((d) => d.tenant_id === tenantId && d.id === id);
  }

  public insertDecisionRequest(dec: DecisionRequest): DecisionRequest {
    this.data.decision_requests.push(dec);
    this.persist();
    return dec;
  }

  public updateDecisionRequest(tenantId: string, id: string, updates: Partial<DecisionRequest>): DecisionRequest {
    const idx = this.data.decision_requests.findIndex((d) => d.tenant_id === tenantId && d.id === id);
    if (idx === -1) throw new Error(`DecisionRequest not found: ${id}`);
    const updated = { ...this.data.decision_requests[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.decision_requests[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Decision Outcomes ---
  public getDecisionOutcomes(tenantId: string): DecisionOutcome[] {
    return this.data.decision_outcomes
      .filter((o) => o.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public insertDecisionOutcome(outcome: DecisionOutcome): DecisionOutcome {
    this.data.decision_outcomes.push(outcome);
    this.persist();
    return outcome;
  }

  // --- Customer Intelligence (RFM & LTV) ---
  public getCustomerIntelligence(tenantId: string): CustomerIntelligenceRecord[] {
    return this.data.customer_intelligence.filter((c) => c.tenant_id === tenantId);
  }

  public upsertCustomerIntelligence(record: CustomerIntelligenceRecord): CustomerIntelligenceRecord {
    const idx = this.data.customer_intelligence.findIndex(
      (c) => c.tenant_id === record.tenant_id && c.customer_id === record.customer_id
    );
    if (idx !== -1) {
      this.data.customer_intelligence[idx] = { ...this.data.customer_intelligence[idx], ...record, updated_at: new Date().toISOString() };
    } else {
      this.data.customer_intelligence.push(record);
    }
    this.persist();
    return record;
  }

  // --- Product Performance ---
  public getProductPerformance(tenantId: string): ProductPerformanceSnapshot[] {
    return this.data.product_performance
      .filter((p) => p.tenant_id === tenantId)
      .sort((a, b) => b.performance_score - a.performance_score);
  }

  public upsertProductPerformance(record: ProductPerformanceSnapshot): ProductPerformanceSnapshot {
    const idx = this.data.product_performance.findIndex(
      (p) => p.tenant_id === record.tenant_id && p.product_id === record.product_id
    );
    if (idx !== -1) {
      this.data.product_performance[idx] = { ...this.data.product_performance[idx], ...record };
    } else {
      this.data.product_performance.push(record);
    }
    this.persist();
    return record;
  }

  // --- Inventory Intelligence ---
  public getInventoryIntelligence(tenantId: string): InventoryIntelligenceSnapshot[] {
    return this.data.inventory_intelligence.filter((i) => i.tenant_id === tenantId);
  }

  public upsertInventoryIntelligence(record: InventoryIntelligenceSnapshot): InventoryIntelligenceSnapshot {
    const idx = this.data.inventory_intelligence.findIndex(
      (i) => i.tenant_id === record.tenant_id && i.variant_id === record.variant_id
    );
    if (idx !== -1) {
      this.data.inventory_intelligence[idx] = { ...this.data.inventory_intelligence[idx], ...record };
    } else {
      this.data.inventory_intelligence.push(record);
    }
    this.persist();
    return record;
  }

  // --- Cohorts ---
  /** Tenant-scoped (FX-21): cohorts were stored by month only, so tenants overwrote each other's rows. */
  public getCohortRecords(tenantId: string): CohortRecord[] {
    return this.data.cohort_records
      .filter((c) => c.tenant_id === tenantId)
      .sort((a, b) => a.cohort_month.localeCompare(b.cohort_month));
  }

  // --- Intelligence snapshots (FX-21) ---
  public getIntelligenceRun(tenantId: string, kind: string): IntelligenceRun | undefined {
    return this.data.intelligence_runs.find((r) => r.tenant_id === tenantId && r.kind === kind);
  }

  /** This tenant's stored rows of a snapshot collection with the given ids, in the order of `ids`. */
  public getComputedRows<T extends { id: string; tenant_id: string }>(
    collection: IntelligenceSnapshotCollection,
    tenantId: string,
    ids: readonly string[]
  ): T[] {
    const wanted = new Set(ids);
    const byId = new Map<string, T>();
    for (const row of this.data[collection] as unknown as T[]) {
      if (row.tenant_id === tenantId && wanted.has(row.id)) byId.set(row.id, row);
    }
    return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
  }

  /**
   * Stores one recomputed snapshot in a single pass and a single persist (FX-21). Rows are matched by their
   * deterministic id, so recomputing is idempotent instead of appending duplicates. Existing rows merge through
   * mergeComputedRow: rows under review are left as they are, and a decision (`keep` fields) survives only while it
   * is unexpired and about the same entities. `replace` also drops this tenant's rows that the recompute no longer
   * produces (per-entity snapshots).
   */
  public upsertComputedRows<T extends { id: string; tenant_id: string }>(
    collection: IntelligenceSnapshotCollection,
    tenantId: string,
    kind: string,
    rows: T[],
    opts: { keep?: readonly string[]; freeze?: readonly string[]; replace?: boolean } = {}
  ): T[] {
    const table = this.data[collection] as unknown as Array<Record<string, unknown> & { id: string; tenant_id: string }>;
    const incoming = new Map(rows.filter((r) => r.tenant_id === tenantId).map((r) => [r.id, r]));
    const stored: T[] = [];
    const next: typeof table = [];
    for (const existing of table) {
      if (existing.tenant_id !== tenantId) {
        next.push(existing);
        continue;
      }
      const fresh = incoming.get(existing.id) as (Record<string, unknown> & T) | undefined;
      if (!fresh) {
        if (!opts.replace) next.push(existing);
        continue;
      }
      const merged = mergeComputedRow(existing, fresh, { keep: opts.keep, freeze: opts.freeze });
      next.push(merged as typeof existing);
      stored.push(merged as unknown as T);
      incoming.delete(existing.id);
    }
    for (const row of incoming.values()) {
      next.push(row as unknown as (typeof table)[number]);
      stored.push(row);
    }
    (this.data as unknown as Record<string, unknown>)[collection] = next;

    const run: IntelligenceRun = {
      id: `irun_${tenantId}_${kind}`,
      tenant_id: tenantId,
      kind,
      computed_at: new Date().toISOString(),
      row_count: rows.length,
      row_ids: rows.map((r) => r.id),
    };
    const runIdx = this.data.intelligence_runs.findIndex((r) => r.id === run.id);
    if (runIdx === -1) this.data.intelligence_runs.push(run);
    else this.data.intelligence_runs[runIdx] = run;

    this.persist();
    return stored;
  }

  // --- Model Registry ---
  public getModelRegistry(): ModelRegistryEntry[] {
    return [...this.data.model_registry];
  }

  public getModelRegistryEntry(id: string): ModelRegistryEntry | undefined {
    return this.data.model_registry.find((m) => m.id === id);
  }

  public upsertModelRegistryEntry(entry: ModelRegistryEntry): ModelRegistryEntry {
    const idx = this.data.model_registry.findIndex((m) => m.id === entry.id);
    if (idx !== -1) {
      this.data.model_registry[idx] = { ...this.data.model_registry[idx], ...entry, updated_at: new Date().toISOString() };
    } else {
      this.data.model_registry.push(entry);
    }
    this.persist();
    return entry;
  }

  // --- Data Quality Reports ---
  public getDataQualityReports(tenantId: string): DataQualityReport[] {
    return this.data.data_quality_reports
      .filter((d) => d.tenant_id === tenantId)
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
  }

  public insertDataQualityReport(report: DataQualityReport): DataQualityReport {
    this.data.data_quality_reports.push(report);
    this.persist();
    return report;
  }

  // --- Phase 7: Growth & Audiences ---
  public getAudiences(tenantId: string): Audience[] {
    return this.data.audiences.filter((a) => a.tenant_id === tenantId);
  }

  public getAudienceById(tenantId: string, id: string): Audience | undefined {
    return this.data.audiences.find((a) => a.tenant_id === tenantId && a.id === id);
  }

  public insertAudience(audience: Audience): Audience {
    this.data.audiences.push(audience);
    this.persist();
    return audience;
  }

  public updateAudience(tenantId: string, id: string, updates: Partial<Audience>): Audience {
    const idx = this.data.audiences.findIndex((a) => a.tenant_id === tenantId && a.id === id);
    if (idx === -1) throw new Error(`Audience not found: ${id}`);
    const updated = { ...this.data.audiences[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.audiences[idx] = updated;
    this.persist();
    return updated;
  }

  public getAudienceMembers(tenantId: string, audienceId: string): AudienceMember[] {
    return this.data.audience_members.filter((m) => m.tenant_id === tenantId && m.audience_id === audienceId);
  }

  public insertAudienceMember(member: AudienceMember): AudienceMember {
    this.data.audience_members.push(member);
    this.persist();
    return member;
  }

  public insertAudienceSnapshot(snapshot: AudienceSnapshot): AudienceSnapshot {
    this.data.audience_snapshots.push(snapshot);
    this.persist();
    return snapshot;
  }

  public getAudienceSnapshots(tenantId: string, audienceId?: string): AudienceSnapshot[] {
    return this.data.audience_snapshots.filter(
      (s) => s.tenant_id === tenantId && (!audienceId || s.audience_id === audienceId)
    );
  }

  // --- Customer Lifecycle ---
  public getCustomerLifecycles(tenantId: string): CustomerLifecycleRecord[] {
    return this.data.customer_lifecycles.filter((l) => l.tenant_id === tenantId);
  }

  public getCustomerLifecycleByCustomerId(tenantId: string, customerId: string): CustomerLifecycleRecord | undefined {
    return this.data.customer_lifecycles.find((l) => l.tenant_id === tenantId && l.customer_id === customerId);
  }

  public upsertCustomerLifecycle(record: CustomerLifecycleRecord): CustomerLifecycleRecord {
    const idx = this.data.customer_lifecycles.findIndex(
      (l) => l.tenant_id === record.tenant_id && l.customer_id === record.customer_id
    );
    if (idx >= 0) {
      this.data.customer_lifecycles[idx] = { ...record, updated_at: new Date().toISOString() };
    } else {
      this.data.customer_lifecycles.push(record);
    }
    this.persist();
    return record;
  }

  public insertLifecycleTransition(transition: CustomerLifecycleTransition): CustomerLifecycleTransition {
    this.data.customer_lifecycle_transitions.push(transition);
    this.persist();
    return transition;
  }

  public getLifecycleTransitions(tenantId: string, customerId?: string): CustomerLifecycleTransition[] {
    return this.data.customer_lifecycle_transitions.filter(
      (t) => t.tenant_id === tenantId && (!customerId || t.customer_id === customerId)
    );
  }

  public batchUpsertCustomerLifecycles(records: CustomerLifecycleRecord[]): void {
    const map = new Map<string, number>();
    for (let i = 0; i < this.data.customer_lifecycles.length; i++) {
      const item = this.data.customer_lifecycles[i];
      map.set(`${item.tenant_id}:${item.customer_id}`, i);
    }
    for (const r of records) {
      const key = `${r.tenant_id}:${r.customer_id}`;
      const existingIdx = map.get(key);
      if (existingIdx !== undefined) {
        this.data.customer_lifecycles[existingIdx] = { ...r, updated_at: new Date().toISOString() };
      } else {
        map.set(key, this.data.customer_lifecycles.length);
        this.data.customer_lifecycles.push(r);
      }
    }
    this.persist();
  }

  public batchInsertLifecycleTransitions(transitions: CustomerLifecycleTransition[]): void {
    this.data.customer_lifecycle_transitions.push(...transitions);
    this.persist();
  }

  // --- Journeys ---
  public getJourneys(tenantId: string): CustomerJourney[] {
    return this.data.journeys.filter((j) => j.tenant_id === tenantId);
  }

  public getJourneyById(tenantId: string, id: string): CustomerJourney | undefined {
    return this.data.journeys.find((j) => j.tenant_id === tenantId && j.id === id);
  }

  public insertJourney(journey: CustomerJourney): CustomerJourney {
    this.data.journeys.push(journey);
    this.persist();
    return journey;
  }

  public updateJourney(tenantId: string, id: string, updates: Partial<CustomerJourney>): CustomerJourney {
    const idx = this.data.journeys.findIndex((j) => j.tenant_id === tenantId && j.id === id);
    if (idx === -1) throw new Error(`Journey not found: ${id}`);
    const updated = { ...this.data.journeys[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.journeys[idx] = updated;
    this.persist();
    return updated;
  }

  public getJourneyEnrollments(tenantId: string, journeyId?: string): JourneyEnrollment[] {
    return this.data.journey_enrollments.filter(
      (e) => e.tenant_id === tenantId && (!journeyId || e.journey_id === journeyId)
    );
  }

  public insertJourneyEnrollment(enrollment: JourneyEnrollment): JourneyEnrollment {
    this.data.journey_enrollments.push(enrollment);
    this.persist();
    return enrollment;
  }

  public updateJourneyEnrollment(tenantId: string, id: string, updates: Partial<JourneyEnrollment>): JourneyEnrollment {
    const idx = this.data.journey_enrollments.findIndex((e) => e.tenant_id === tenantId && e.id === id);
    if (idx === -1) throw new Error(`JourneyEnrollment not found: ${id}`);
    const updated = { ...this.data.journey_enrollments[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.journey_enrollments[idx] = updated;
    this.persist();
    return updated;
  }

  public insertJourneyExecution(record: JourneyExecutionRecord): JourneyExecutionRecord {
    this.data.journey_executions.push(record);
    this.persist();
    return record;
  }

  // --- Campaigns ---
  public getCampaigns(tenantId: string): GrowthCampaign[] {
    return this.data.campaigns.filter((c) => c.tenant_id === tenantId);
  }

  public getCampaignById(tenantId: string, id: string): GrowthCampaign | undefined {
    return this.data.campaigns.find((c) => c.tenant_id === tenantId && c.id === id);
  }

  public insertCampaign(campaign: GrowthCampaign): GrowthCampaign {
    this.data.campaigns.push(campaign);
    this.persist();
    return campaign;
  }

  public updateCampaign(tenantId: string, id: string, updates: Partial<GrowthCampaign>): GrowthCampaign {
    const idx = this.data.campaigns.findIndex((c) => c.tenant_id === tenantId && c.id === id);
    if (idx === -1) throw new Error(`Campaign not found: ${id}`);
    const updated = { ...this.data.campaigns[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.campaigns[idx] = updated;
    this.persist();
    return updated;
  }

  public getCampaignExecutions(tenantId: string, campaignId?: string): CampaignExecutionRecord[] {
    return this.data.campaign_executions.filter(
      (e) => e.tenant_id === tenantId && (!campaignId || e.campaign_id === campaignId)
    );
  }

  public insertCampaignExecution(exec: CampaignExecutionRecord): CampaignExecutionRecord {
    this.data.campaign_executions.push(exec);
    this.persist();
    return exec;
  }

  public updateCampaignExecution(tenantId: string, id: string, updates: Partial<CampaignExecutionRecord>): CampaignExecutionRecord {
    const idx = this.data.campaign_executions.findIndex((e) => e.tenant_id === tenantId && e.id === id);
    if (idx === -1) throw new Error(`CampaignExecution not found: ${id}`);
    const updated = { ...this.data.campaign_executions[idx], ...safePatch(updates) };
    this.data.campaign_executions[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Abandoned Carts ---
  public getAbandonedCarts(tenantId: string): AbandonedCartRecoveryItem[] {
    return this.data.abandoned_carts.filter((c) => c.tenant_id === tenantId);
  }

  public getAbandonedCartById(tenantId: string, id: string): AbandonedCartRecoveryItem | undefined {
    return this.data.abandoned_carts.find((c) => c.tenant_id === tenantId && c.id === id);
  }

  public insertAbandonedCart(cart: AbandonedCartRecoveryItem): AbandonedCartRecoveryItem {
    this.data.abandoned_carts.push(cart);
    this.persist();
    return cart;
  }

  public updateAbandonedCart(tenantId: string, id: string, updates: Partial<AbandonedCartRecoveryItem>): AbandonedCartRecoveryItem {
    const idx = this.data.abandoned_carts.findIndex((c) => c.tenant_id === tenantId && c.id === id);
    if (idx === -1) throw new Error(`AbandonedCart not found: ${id}`);
    const updated = { ...this.data.abandoned_carts[idx], ...safePatch(updates) };
    this.data.abandoned_carts[idx] = updated;
    this.persist();
    return updated;
  }

  // --- Executive Business Digests ---
  public getExecutiveDigests(tenantId: string): ExecutiveDigest[] {
    return this.data.executive_digests.filter((d) => d.tenant_id === tenantId);
  }

  public getExecutiveDigestById(tenantId: string, id: string): ExecutiveDigest | undefined {
    return this.data.executive_digests.find((d) => d.tenant_id === tenantId && d.id === id);
  }

  public insertExecutiveDigest(digest: ExecutiveDigest): ExecutiveDigest {
    this.data.executive_digests.unshift(digest);
    this.persist();
    return digest;
  }

  // --- Content & Offers ---
  public getContentAssets(tenantId: string): ContentAsset[] {
    return this.data.content_assets.filter((a) => a.tenant_id === tenantId);
  }

  public insertContentAsset(asset: ContentAsset): ContentAsset {
    this.data.content_assets.push(asset);
    this.persist();
    return asset;
  }

  public getContentTemplates(tenantId: string): ContentTemplate[] {
    return this.data.content_templates.filter((t) => t.tenant_id === tenantId);
  }

  public insertContentTemplate(tpl: ContentTemplate): ContentTemplate {
    this.data.content_templates.push(tpl);
    this.persist();
    return tpl;
  }

  public getOffers(tenantId: string): GrowthOffer[] {
    return this.data.offers.filter((o) => o.tenant_id === tenantId);
  }

  public getOfferById(tenantId: string, id: string): GrowthOffer | undefined {
    return this.data.offers.find((o) => o.tenant_id === tenantId && o.id === id);
  }

  public insertOffer(offer: GrowthOffer): GrowthOffer {
    this.data.offers.push(offer);
    this.persist();
    return offer;
  }

  public updateOffer(tenantId: string, id: string, updates: Partial<GrowthOffer>): GrowthOffer {
    const idx = this.data.offers.findIndex((o) => o.tenant_id === tenantId && o.id === id);
    if (idx === -1) throw new Error(`Offer not found: ${id}`);
    const updated = { ...this.data.offers[idx], ...safePatch(updates) };
    this.data.offers[idx] = updated;
    this.persist();
    return updated;
  }

  public getOfferUsages(tenantId: string, offerId?: string): OfferUsage[] {
    return this.data.offer_usages.filter(
      (u) => u.tenant_id === tenantId && (!offerId || u.offer_id === offerId)
    );
  }

  public insertOfferUsage(usage: OfferUsage): OfferUsage {
    this.data.offer_usages.push(usage);
    this.persist();
    return usage;
  }

  // --- Experiments ---
  public getExperiments(tenantId: string): GrowthExperiment[] {
    return this.data.experiments.filter((e) => e.tenant_id === tenantId);
  }

  public getExperimentById(tenantId: string, id: string): GrowthExperiment | undefined {
    return this.data.experiments.find((e) => e.tenant_id === tenantId && e.id === id);
  }

  public insertExperiment(exp: GrowthExperiment): GrowthExperiment {
    this.data.experiments.push(exp);
    this.persist();
    return exp;
  }

  public updateExperiment(tenantId: string, id: string, updates: Partial<GrowthExperiment>): GrowthExperiment {
    const idx = this.data.experiments.findIndex((e) => e.tenant_id === tenantId && e.id === id);
    if (idx === -1) throw new Error(`Experiment not found: ${id}`);
    const updated = { ...this.data.experiments[idx], ...safePatch(updates) };
    this.data.experiments[idx] = updated;
    this.persist();
    return updated;
  }

  public getExperimentAssignments(tenantId: string, experimentId: string): ExperimentAssignment[] {
    return this.data.experiment_assignments.filter(
      (a) => a.tenant_id === tenantId && a.experiment_id === experimentId
    );
  }

  public insertExperimentAssignment(asgn: ExperimentAssignment): ExperimentAssignment {
    this.data.experiment_assignments.push(asgn);
    this.persist();
    return asgn;
  }

  // --- Consent & Suppression ---
  public getCommunicationPreferences(tenantId: string, customerId?: string): CustomerCommunicationPreference[] {
    return this.data.communication_preferences.filter(
      (p) => p.tenant_id === tenantId && (!customerId || p.customer_id === customerId)
    );
  }

  public upsertCommunicationPreference(pref: CustomerCommunicationPreference): CustomerCommunicationPreference {
    const idx = this.data.communication_preferences.findIndex(
      (p) => p.tenant_id === pref.tenant_id && p.customer_id === pref.customer_id && p.channel === pref.channel
    );
    if (idx >= 0) {
      this.data.communication_preferences[idx] = { ...pref, updated_at: new Date().toISOString() };
    } else {
      this.data.communication_preferences.push(pref);
    }
    this.persist();
    return pref;
  }

  public getSuppressionEntries(tenantId: string, customerId?: string): SuppressionEntry[] {
    return this.data.suppression_list.filter(
      (s) => s.tenant_id === tenantId && (!customerId || s.customer_id === customerId)
    );
  }

  public insertSuppressionEntry(entry: SuppressionEntry): SuppressionEntry {
    this.data.suppression_list.push(entry);
    this.persist();
    return entry;
  }

  // --- Attribution ---
  public getCampaignAttributions(tenantId: string, campaignId?: string): CampaignAttribution[] {
    return this.data.campaign_attributions.filter((a) => {
      if (a.tenant_id !== tenantId) return false;
      if (!campaignId) return true;
      return a.campaign_credits[campaignId] !== undefined;
    });
  }

  public insertCampaignAttribution(attrib: CampaignAttribution): CampaignAttribution {
    this.data.campaign_attributions.push(attrib);
    this.persist();
    return attrib;
  }

  // --- Growth Intelligence & Recommendations ---
  public getGrowthInsights(tenantId: string): GrowthInsight[] {
    return this.data.growth_insights.filter((i) => i.tenant_id === tenantId);
  }

  public insertGrowthInsight(insight: GrowthInsight): GrowthInsight {
    this.data.growth_insights.push(insight);
    this.persist();
    return insight;
  }

  public getGrowthRecommendations(tenantId: string): GrowthRecommendation[] {
    return this.data.growth_recommendations.filter((r) => r.tenant_id === tenantId);
  }

  public insertGrowthRecommendation(rec: GrowthRecommendation): GrowthRecommendation {
    this.data.growth_recommendations.push(rec);
    this.persist();
    return rec;
  }

  public updateGrowthRecommendation(tenantId: string, id: string, updates: Partial<GrowthRecommendation>): GrowthRecommendation {
    const idx = this.data.growth_recommendations.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) throw new Error(`GrowthRecommendation not found: ${id}`);
    const updated = { ...this.data.growth_recommendations[idx], ...safePatch(updates) };
    this.data.growth_recommendations[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== PHASE 8: PROCUREMENT ACCESSORS ====================
  public getSuppliers(tenantId: string): Supplier[] {
    return this.data.suppliers.filter((s) => s.tenant_id === tenantId);
  }

  public findSupplierById(tenantId: string, id: string): Supplier | undefined {
    return this.data.suppliers.find((s) => s.tenant_id === tenantId && s.id === id);
  }

  public createSupplier(supplier: Supplier): Supplier {
    this.data.suppliers.push(supplier);
    this.persist();
    return supplier;
  }

  public updateSupplier(tenantId: string, id: string, updates: Partial<Supplier>): Supplier {
    const idx = this.data.suppliers.findIndex((s) => s.tenant_id === tenantId && s.id === id);
    if (idx === -1) throw new Error(`Supplier not found: ${id}`);
    const updated = { ...this.data.suppliers[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.suppliers[idx] = updated;
    this.persist();
    return updated;
  }

  public getSupplierProducts(tenantId: string, supplierId?: string): SupplierProduct[] {
    return this.data.supplier_products.filter(
      (sp) => sp.tenant_id === tenantId && (!supplierId || sp.supplier_id === supplierId)
    );
  }

  public createSupplierProduct(sp: SupplierProduct): SupplierProduct {
    this.data.supplier_products.push(sp);
    this.persist();
    return sp;
  }

  public getPurchaseOrders(tenantId: string): PurchaseOrder[] {
    return this.data.purchase_orders.filter((po) => po.tenant_id === tenantId);
  }

  public findPurchaseOrderById(tenantId: string, id: string): PurchaseOrder | undefined {
    return this.data.purchase_orders.find((po) => po.tenant_id === tenantId && po.id === id);
  }

  public createPurchaseOrder(po: PurchaseOrder): PurchaseOrder {
    this.data.purchase_orders.push(po);
    this.persist();
    return po;
  }

  public updatePurchaseOrder(tenantId: string, id: string, updates: Partial<PurchaseOrder>): PurchaseOrder {
    const idx = this.data.purchase_orders.findIndex((po) => po.tenant_id === tenantId && po.id === id);
    if (idx === -1) throw new Error(`PurchaseOrder not found: ${id}`);
    const updated = { ...this.data.purchase_orders[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.purchase_orders[idx] = updated;
    this.persist();
    return updated;
  }

  public getProcurementRecommendations(tenantId: string): ProcurementRecommendation[] {
    return this.data.procurement_recommendations.filter((pr) => pr.tenant_id === tenantId);
  }

  public createProcurementRecommendation(pr: ProcurementRecommendation): ProcurementRecommendation {
    this.data.procurement_recommendations.push(pr);
    this.persist();
    return pr;
  }

  public updateProcurementRecommendation(tenantId: string, id: string, updates: Partial<ProcurementRecommendation>): ProcurementRecommendation {
    const idx = this.data.procurement_recommendations.findIndex((pr) => pr.tenant_id === tenantId && pr.id === id);
    if (idx === -1) throw new Error(`ProcurementRecommendation not found: ${id}`);
    const updated = { ...this.data.procurement_recommendations[idx], ...safePatch(updates) };
    this.data.procurement_recommendations[idx] = updated;
    this.persist();
    return updated;
  }

  public getSupplierPerformances(tenantId: string): SupplierPerformance[] {
    return this.data.supplier_performances.filter((sp) => sp.tenant_id === tenantId);
  }

  public upsertSupplierPerformance(sp: SupplierPerformance): SupplierPerformance {
    const idx = this.data.supplier_performances.findIndex((p) => p.tenant_id === sp.tenant_id && p.supplier_id === sp.supplier_id);
    if (idx !== -1) {
      this.data.supplier_performances[idx] = sp;
    } else {
      this.data.supplier_performances.push(sp);
    }
    this.persist();
    return sp;
  }

  // ==================== PHASE 8: PRICING ACCESSORS ====================
  public getPricingRules(tenantId: string): PricingRule[] {
    return this.data.pricing_rules.filter((pr) => pr.tenant_id === tenantId);
  }

  public createPricingRule(rule: PricingRule): PricingRule {
    this.data.pricing_rules.push(rule);
    this.persist();
    return rule;
  }

  public updatePricingRule(tenantId: string, id: string, updates: Partial<PricingRule>): PricingRule {
    const idx = this.data.pricing_rules.findIndex((pr) => pr.tenant_id === tenantId && pr.id === id);
    if (idx === -1) throw new Error(`PricingRule not found: ${id}`);
    const updated = { ...this.data.pricing_rules[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.pricing_rules[idx] = updated;
    this.persist();
    return updated;
  }

  public getPricingRecommendations(tenantId: string): PricingRecommendation[] {
    return this.data.pricing_recommendations.filter((pr) => pr.tenant_id === tenantId);
  }

  public createPricingRecommendation(rec: PricingRecommendation): PricingRecommendation {
    this.data.pricing_recommendations.push(rec);
    this.persist();
    return rec;
  }

  public updatePricingRecommendation(tenantId: string, id: string, updates: Partial<PricingRecommendation>): PricingRecommendation {
    const idx = this.data.pricing_recommendations.findIndex((pr) => pr.tenant_id === tenantId && pr.id === id);
    if (idx === -1) throw new Error(`PricingRecommendation not found: ${id}`);
    const updated = { ...this.data.pricing_recommendations[idx], ...safePatch(updates) };
    this.data.pricing_recommendations[idx] = updated;
    this.persist();
    return updated;
  }

  public getPriceChangeRequests(tenantId: string): PriceChangeRequest[] {
    return this.data.price_change_requests.filter((pcr) => pcr.tenant_id === tenantId);
  }

  public createPriceChangeRequest(req: PriceChangeRequest): PriceChangeRequest {
    this.data.price_change_requests.push(req);
    this.persist();
    return req;
  }

  public updatePriceChangeRequest(tenantId: string, id: string, updates: Partial<PriceChangeRequest>): PriceChangeRequest {
    const idx = this.data.price_change_requests.findIndex((pcr) => pcr.tenant_id === tenantId && pcr.id === id);
    if (idx === -1) throw new Error(`PriceChangeRequest not found: ${id}`);
    const updated = { ...this.data.price_change_requests[idx], ...safePatch(updates) };
    this.data.price_change_requests[idx] = updated;
    this.persist();
    return updated;
  }

  public getPriceChangeExecutions(tenantId: string): PriceChangeExecution[] {
    return this.data.price_change_executions.filter((pce) => pce.tenant_id === tenantId);
  }

  public recordPriceChangeExecution(exec: PriceChangeExecution): PriceChangeExecution {
    this.data.price_change_executions.push(exec);
    this.persist();
    return exec;
  }

  // ==================== PHASE 8: FULFILLMENT & COURIER ACCESSORS ====================
  public getCourierPerformances(tenantId: string): CourierPerformance[] {
    return this.data.courier_performances.filter((cp) => cp.tenant_id === tenantId);
  }

  public upsertCourierPerformance(cp: CourierPerformance): CourierPerformance {
    const idx = this.data.courier_performances.findIndex((p) => p.tenant_id === cp.tenant_id && p.courier_provider === cp.courier_provider);
    if (idx !== -1) {
      this.data.courier_performances[idx] = cp;
    } else {
      this.data.courier_performances.push(cp);
    }
    this.persist();
    return cp;
  }

  public getShipmentExceptions(tenantId: string): ShipmentException[] {
    return this.data.shipment_exceptions.filter((se) => se.tenant_id === tenantId);
  }

  public createShipmentException(se: ShipmentException): ShipmentException {
    this.data.shipment_exceptions.push(se);
    this.persist();
    return se;
  }

  public updateShipmentException(tenantId: string, id: string, updates: Partial<ShipmentException>): ShipmentException {
    const idx = this.data.shipment_exceptions.findIndex((se) => se.tenant_id === tenantId && se.id === id);
    if (idx === -1) throw new Error(`ShipmentException not found: ${id}`);
    const updated = { ...this.data.shipment_exceptions[idx], ...safePatch(updates) };
    this.data.shipment_exceptions[idx] = updated;
    this.persist();
    return updated;
  }

  public getFulfillmentPlans(tenantId: string): FulfillmentPlan[] {
    return this.data.fulfillment_plans.filter((fp) => fp.tenant_id === tenantId);
  }

  public createFulfillmentPlan(plan: FulfillmentPlan): FulfillmentPlan {
    this.data.fulfillment_plans.push(plan);
    this.persist();
    return plan;
  }

  // ==================== PHASE 8: PAYMENT & FINANCE ACCESSORS ====================
  public getPaymentOperations(tenantId: string): PaymentOperation[] {
    return this.data.payment_operations.filter((po) => po.tenant_id === tenantId);
  }

  public recordPaymentOperation(op: PaymentOperation): PaymentOperation {
    this.data.payment_operations.push(op);
    this.persist();
    return op;
  }

  public getPaymentExceptions(tenantId: string): PaymentException[] {
    return this.data.payment_exceptions.filter((pe) => pe.tenant_id === tenantId);
  }

  public createPaymentException(pe: PaymentException): PaymentException {
    this.data.payment_exceptions.push(pe);
    this.persist();
    return pe;
  }

  public updatePaymentException(tenantId: string, id: string, updates: Partial<PaymentException>): PaymentException {
    const idx = this.data.payment_exceptions.findIndex((pe) => pe.tenant_id === tenantId && pe.id === id);
    if (idx === -1) throw new Error(`PaymentException not found: ${id}`);
    const updated = { ...this.data.payment_exceptions[idx], ...safePatch(updates) };
    this.data.payment_exceptions[idx] = updated;
    this.persist();
    return updated;
  }

  public getReconciliationRuns(tenantId: string): ReconciliationRun[] {
    return this.data.reconciliation_runs.filter((rr) => rr.tenant_id === tenantId);
  }

  public createReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    this.data.reconciliation_runs.push(run);
    this.persist();
    return run;
  }

  public getReconciliationItems(tenantId: string, runId?: string): ReconciliationItem[] {
    return this.data.reconciliation_items.filter(
      (ri) => ri.tenant_id === tenantId && (!runId || ri.run_id === runId)
    );
  }

  public createReconciliationItem(item: ReconciliationItem): ReconciliationItem {
    this.data.reconciliation_items.push(item);
    this.persist();
    return item;
  }

  public getFinancialExceptions(tenantId: string): FinancialException[] {
    return this.data.financial_exceptions.filter((fe) => fe.tenant_id === tenantId);
  }

  public createFinancialException(fe: FinancialException): FinancialException {
    this.data.financial_exceptions.push(fe);
    this.persist();
    return fe;
  }

  public updateFinancialException(tenantId: string, id: string, updates: Partial<FinancialException>): FinancialException {
    const idx = this.data.financial_exceptions.findIndex((fe) => fe.tenant_id === tenantId && fe.id === id);
    if (idx === -1) throw new Error(`FinancialException not found: ${id}`);
    const updated = { ...this.data.financial_exceptions[idx], ...safePatch(updates) };
    this.data.financial_exceptions[idx] = updated;
    this.persist();
    return updated;
  }

  public getSettlementRecords(tenantId: string): SettlementRecord[] {
    return this.data.settlement_records.filter((sr) => sr.tenant_id === tenantId);
  }

  public createSettlementRecord(sr: SettlementRecord): SettlementRecord {
    this.data.settlement_records.push(sr);
    this.persist();
    return sr;
  }

  // ==================== PHASE 8: CUSTOMER SUPPORT ACCESSORS ====================
  public getSupportTickets(tenantId: string): SupportTicket[] {
    return this.data.support_tickets.filter((st) => st.tenant_id === tenantId);
  }

  public findSupportTicketById(tenantId: string, id: string): SupportTicket | undefined {
    return this.data.support_tickets.find((st) => st.tenant_id === tenantId && st.id === id);
  }

  public createSupportTicket(ticket: SupportTicket): SupportTicket {
    this.data.support_tickets.push(ticket);
    this.persist();
    return ticket;
  }

  public updateSupportTicket(tenantId: string, id: string, updates: Partial<SupportTicket>): SupportTicket {
    const idx = this.data.support_tickets.findIndex((st) => st.tenant_id === tenantId && st.id === id);
    if (idx === -1) throw new Error(`SupportTicket not found: ${id}`);
    const updated = { ...this.data.support_tickets[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.support_tickets[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== PHASE 8: EXCEPTION MANAGEMENT ACCESSORS ====================
  public getOperationalExceptions(tenantId: string): OperationalException[] {
    return this.data.operational_exceptions.filter((oe) => oe.tenant_id === tenantId);
  }

  public findOperationalExceptionById(tenantId: string, id: string): OperationalException | undefined {
    return this.data.operational_exceptions.find((oe) => oe.tenant_id === tenantId && oe.id === id);
  }

  public createOperationalException(oe: OperationalException): OperationalException {
    this.data.operational_exceptions.push(oe);
    this.persist();
    return oe;
  }

  public updateOperationalException(tenantId: string, id: string, updates: Partial<OperationalException>): OperationalException {
    const idx = this.data.operational_exceptions.findIndex((oe) => oe.tenant_id === tenantId && oe.id === id);
    if (idx === -1) throw new Error(`OperationalException not found: ${id}`);
    const updated = { ...this.data.operational_exceptions[idx], ...safePatch(updates), updated_at: new Date().toISOString() };
    this.data.operational_exceptions[idx] = updated;
    this.persist();
    return updated;
  }

  public getExceptionPolicies(tenantId: string): ExceptionPolicy[] {
    return this.data.exception_policies.filter((ep) => ep.tenant_id === tenantId);
  }

  public upsertExceptionPolicy(ep: ExceptionPolicy): ExceptionPolicy {
    const idx = this.data.exception_policies.findIndex((p) => p.tenant_id === ep.tenant_id && p.exception_type === ep.exception_type);
    if (idx !== -1) {
      this.data.exception_policies[idx] = ep;
    } else {
      this.data.exception_policies.push(ep);
    }
    this.persist();
    return ep;
  }

  // ==================== PHASE 8: PROVIDER HEALTH ACCESSORS ====================
  public getProviderHealthList(tenantId: string): ProviderHealth[] {
    return this.data.provider_health.filter((ph) => ph.tenant_id === tenantId);
  }

  public getProviderHealth(tenantId: string, providerId: string): ProviderHealth | undefined {
    return this.data.provider_health.find((ph) => ph.tenant_id === tenantId && ph.provider_id === providerId);
  }

  public upsertProviderHealth(ph: ProviderHealth): ProviderHealth {
    const idx = this.data.provider_health.findIndex((p) => p.tenant_id === ph.tenant_id && p.provider_id === ph.provider_id);
    if (idx !== -1) {
      this.data.provider_health[idx] = ph;
    } else {
      this.data.provider_health.push(ph);
    }
    this.persist();
    return ph;
  }

  public getProviderIncidents(tenantId: string): ProviderIncident[] {
    return this.data.provider_incidents.filter((pi) => pi.tenant_id === tenantId);
  }

  public createProviderIncident(incident: ProviderIncident): ProviderIncident {
    this.data.provider_incidents.push(incident);
    this.persist();
    return incident;
  }

  public updateProviderIncident(tenantId: string, id: string, updates: Partial<ProviderIncident>): ProviderIncident {
    const idx = this.data.provider_incidents.findIndex((pi) => pi.tenant_id === tenantId && pi.id === id);
    if (idx === -1) throw new Error(`ProviderIncident not found: ${id}`);
    const updated = { ...this.data.provider_incidents[idx], ...safePatch(updates) };
    this.data.provider_incidents[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== PHASE 8: SLA ACCESSORS ====================
  public getSLAPolicies(tenantId: string): SLAPolicy[] {
    return this.data.sla_policies.filter((sp) => sp.tenant_id === tenantId);
  }

  public upsertSLAPolicy(sp: SLAPolicy): SLAPolicy {
    const idx = this.data.sla_policies.findIndex((p) => p.tenant_id === sp.tenant_id && p.domain === sp.domain);
    if (idx !== -1) {
      this.data.sla_policies[idx] = sp;
    } else {
      this.data.sla_policies.push(sp);
    }
    this.persist();
    return sp;
  }

  public getSLABreaches(tenantId: string): SLABreach[] {
    return this.data.sla_breaches.filter((sb) => sb.tenant_id === tenantId);
  }

  public createSLABreach(sb: SLABreach): SLABreach {
    this.data.sla_breaches.push(sb);
    this.persist();
    return sb;
  }

  public updateSLABreach(tenantId: string, id: string, updates: Partial<SLABreach>): SLABreach {
    const idx = this.data.sla_breaches.findIndex((sb) => sb.tenant_id === tenantId && sb.id === id);
    if (idx === -1) throw new Error(`SLABreach not found: ${id}`);
    const updated = { ...this.data.sla_breaches[idx], ...safePatch(updates) };
    this.data.sla_breaches[idx] = updated;
    this.persist();
    return updated;
  }

  // ==================== PHASE 8: AUTONOMY BUDGET & BULK SAFEGUARDS ====================
  public getAutonomyBudget(tenantId: string): AutonomyBudget | undefined {
    return this.data.autonomy_budgets.find((ab) => ab.tenant_id === tenantId);
  }

  public upsertAutonomyBudget(budget: AutonomyBudget): AutonomyBudget {
    const idx = this.data.autonomy_budgets.findIndex((b) => b.tenant_id === budget.tenant_id);
    if (idx !== -1) {
      this.data.autonomy_budgets[idx] = budget;
    } else {
      this.data.autonomy_budgets.push(budget);
    }
    this.persist();
    return budget;
  }

  public getBulkSafeguards(tenantId: string): BulkOperationSafeguard[] {
    return this.data.bulk_safeguards.filter((bs) => bs.tenant_id === tenantId);
  }

  public createBulkSafeguard(bs: BulkOperationSafeguard): BulkOperationSafeguard {
    this.data.bulk_safeguards.push(bs);
    this.persist();
    return bs;
  }

  public updateBulkSafeguard(tenantId: string, id: string, updates: Partial<BulkOperationSafeguard>): BulkOperationSafeguard {
    const idx = this.data.bulk_safeguards.findIndex((bs) => bs.tenant_id === tenantId && bs.id === id);
    if (idx === -1) throw new Error(`BulkOperationSafeguard not found: ${id}`);
    const updated = { ...this.data.bulk_safeguards[idx], ...safePatch(updates) };
    this.data.bulk_safeguards[idx] = updated;
    this.persist();
    return updated;
  }

  // For clean test suite execution
  public clearAllForTesting(): void {
    // An explicitly persistent store (the Postgres test mode) keeps saving, so the clear itself is exercised.
    if (this.options.persist !== true) this.isTestInstance = true;
    this.data = {
      tenants: [],
      users: [],
      memberships: [],
      invitations: [],
      audit_logs: [],
      products: [],
      product_variants: [],
      categories: [],
      brands: [],
      warehouses: [],
      inventory_items: [],
      stock_movements: [],
      inventory_reservations: [],
      order_sequences: {},
      customers: [],
      customer_addresses: [],
      orders: [],
      order_items: [],
      payments: [],
      shipments: [],
      returns: [],
      refunds: [],
      coupons: [],
      events: [],
      webhooks: [],
      connected_channels: [],
      customer_identities: [],
      conversations: [],
      messages: [],
      conversation_assignments: [],
      conversation_tags: [],
      leads: [],
      attachments: [],
      quick_replies: [],
      business_hours: [],
      chat_sessions: [],
      outbound_webhook_deliveries: [],
      agents: [],
      agent_policies: [],
      agent_runs: [],
      agent_tool_calls: [],
      agent_prompts: [],
      prompt_versions: [],
      conversation_summaries: [],
      customer_memories: [],
      knowledge_documents: [],
      knowledge_chunks: [],
      ai_traces: [],
      ai_usage: [],
      ai_feedback: [],
      // Phase 5 Collections
      workflows: [],
      tasks: [],
      agent_messages: [],
      workflow_contexts: [],
      workflow_artifacts: [],
      workflow_checkpoints: [],
      agent_delegations: [],
      agent_verifications: [],
      approval_requests: [],
      autonomy_policies: [],
      workflow_templates: [],
      trigger_rules: [],
      action_receipts: [],
      agent_schedules: [],
      // Phase 6 Collections
      analytics_events: [],
      metric_definitions: [],
      metric_snapshots: [],
      insights: [],
      anomalies: [],
      opportunities: [],
      risks: [],
      recommendations: [],
      forecast_runs: [],
      simulations: [],
      decision_requests: [],
      decision_outcomes: [],
      customer_intelligence: [],
      product_performance: [],
      inventory_intelligence: [],
      cohort_records: [],
      intelligence_runs: [],
      model_registry: [],
      data_quality_reports: [],
      // Phase 7 Collections
      audiences: [],
      audience_members: [],
      audience_snapshots: [],
      customer_lifecycles: [],
      customer_lifecycle_transitions: [],
      journeys: [],
      journey_enrollments: [],
      journey_executions: [],
      campaigns: [],
      campaign_executions: [],
      content_assets: [],
      content_templates: [],
      offers: [],
      offer_usages: [],
      experiments: [],
      experiment_assignments: [],
      communication_preferences: [],
      suppression_list: [],
      campaign_attributions: [],
      growth_insights: [],
      growth_recommendations: [],
      abandoned_carts: [],
      executive_digests: [],
      // Phase 8 Collections
      suppliers: [],
      supplier_products: [],
      purchase_orders: [],
      procurement_recommendations: [],
      supplier_performances: [],
      pricing_rules: [],
      pricing_recommendations: [],
      price_change_requests: [],
      price_change_executions: [],
      shipment_exceptions: [],
      courier_performances: [],
      fulfillment_plans: [],
      payment_operations: [],
      payment_exceptions: [],
      reconciliation_runs: [],
      reconciliation_items: [],
      financial_exceptions: [],
      settlement_records: [],
      support_tickets: [],
      operational_exceptions: [],
      exception_policies: [],
      provider_health: [],
      provider_incidents: [],
      sla_policies: [],
      sla_breaches: [],
      autonomy_budgets: [],
      bulk_safeguards: [],
      // Phase 9 Collections
      organizations: [],
      business_units: [],
      brand_groups: [],
      enterprise_brands: [],
      enterprise_stores: [],
      sales_channels: [],
      regions: [],
      entity_memberships: [],
      enterprise_users: [],
      semantic_metrics: [],
      enterprise_benchmarks: [],
      report_definitions: [],
      report_executions: [],
      integration_providers: [],
      integration_installations: [],
      integration_mappings: [],
      integration_conflicts: [],
      integration_syncs: [],
      developer_applications: [],
      api_keys: [],
      enterprise_webhooks: [],
      webhook_deliveries: [],
      data_assets: [],
      data_lineage: [],
      data_quality_rules: [],
      data_quality_issues: [],
      enterprise_customer_identities: [],
      enterprise_incidents: [],
      enterprise_ai_budgets: [],
      ai_usage_records: [],
      // Phase 10 Collections
      business_objectives: [],
      objective_runs: [],
      objective_outcomes: [],
      strategies: [],
      global_decisions: [],
      cross_domain_messages: [],
      agent_proposals: [],
      agent_conflicts: [],
      learning_candidates: [],
      ai_models: [],
      model_deployments: [],
      ai_providers: [],
      autonomy_recommendations: [],
      platform_health_records: [],
      slo_definitions: [],
      error_budgets: [],
      data_residency_policies: [],
      global_events: [],
      extensions: [],
      plugins: [],
      platform_cost_records: [],
      autonomous_quality_scores: [],
      autonomous_workflow_runs: [],
      chaos_test_scenarios: [],
      load_test_scenarios: [],
      rollback_actions: [],
      automations: [],
      automation_workflows: [],
      automation_workflow_versions: [],
      n8n_instances: [],
      automation_triggers: [],
      automation_executions: [],
      automation_execution_steps: [],
      idempotency_records: [],
      automation_retries: [],
      automation_dead_letters: [],
      automation_webhooks: [],
      automation_webhook_deliveries: [],
      automation_audit_logs: [],
      connector_configurations: [],
      platform_memberships: [],
      service_tokens: [],
      plans: [],
      plan_versions: [],
      subscriptions: [],
      entitlements: [],
      tenant_entitlements: [],
      usage_records: [],
      platform_feature_flags: [],
      platform_settings: [],
      platform_setting_versions: [],
      platform_incidents: [],
      platform_maintenance_windows: [],
      platform_audit_logs: [],
      platform_kill_switches: [],
      platform_security_events: [],
      platform_announcements: [],
      platform_api_keys: [],
      impersonation_sessions: [],
    };
    this.ensureDefaultSeed();
  }

  // ============================================================
  // PHASE 9: ENTERPRISE COMMERCE INTELLIGENCE METHODS
  // ============================================================

  public getOrganizations(): Organization[] {
    return this.data.organizations;
  }

  public findOrganizationById(id: string): Organization | undefined {
    return this.data.organizations.find((o) => o.id === id);
  }

  public createOrganization(org: Organization): Organization {
    this.data.organizations.push(org);
    this.persist();
    return org;
  }

  public updateOrganization(id: string, updates: Partial<Organization>): Organization {
    const idx = this.data.organizations.findIndex((o) => o.id === id);
    if (idx === -1) throw new Error(`Organization not found: ${id}`);
    this.data.organizations[idx] = {
      ...this.data.organizations[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.organizations[idx];
  }

  public getBusinessUnits(orgId: string): BusinessUnit[] {
    return this.data.business_units.filter((b) => b.organization_id === orgId);
  }

  public createBusinessUnit(bu: BusinessUnit): BusinessUnit {
    this.data.business_units.push(bu);
    this.persist();
    return bu;
  }

  public getEnterpriseBrands(orgId: string): EnterpriseBrand[] {
    return this.data.enterprise_brands.filter((b) => b.organization_id === orgId);
  }

  public createEnterpriseBrand(brand: EnterpriseBrand): EnterpriseBrand {
    this.data.enterprise_brands.push(brand);
    this.persist();
    return brand;
  }

  public getEnterpriseStores(orgId: string): EnterpriseStore[] {
    return this.data.enterprise_stores.filter((s) => s.organization_id === orgId);
  }

  public createEnterpriseStore(store: EnterpriseStore): EnterpriseStore {
    this.data.enterprise_stores.push(store);
    this.persist();
    return store;
  }

  public findEnterpriseStoreById(orgId: string, storeId: string): EnterpriseStore | undefined {
    return this.data.enterprise_stores.find((s) => s.organization_id === orgId && s.id === storeId);
  }

  public getEntityMemberships(orgId: string, userId?: string): EntityMembership[] {
    return this.data.entity_memberships.filter((m) => m.organization_id === orgId && (!userId || m.user_id === userId));
  }

  public createEntityMembership(m: EntityMembership): EntityMembership {
    this.data.entity_memberships.push(m);
    this.persist();
    return m;
  }

  public getEnterpriseUsers(orgId: string): EnterpriseUserRecord[] {
    return this.data.enterprise_users.filter((u) => u.organization_id === orgId);
  }

  public createEnterpriseUser(u: EnterpriseUserRecord): EnterpriseUserRecord {
    this.data.enterprise_users.push(u);
    this.persist();
    return u;
  }

  public getSemanticMetrics(orgId: string): EnterpriseMetricDefinition[] {
    return this.data.semantic_metrics.filter((m) => m.organization_id === orgId);
  }

  public createSemanticMetric(m: EnterpriseMetricDefinition): EnterpriseMetricDefinition {
    this.data.semantic_metrics.push(m);
    this.persist();
    return m;
  }

  public findSemanticMetricByKey(orgId: string, key: string): EnterpriseMetricDefinition | undefined {
    return this.data.semantic_metrics.find((m) => m.organization_id === orgId && m.key === key);
  }

  public getEnterpriseBenchmarks(orgId: string): EnterpriseBenchmark[] {
    return this.data.enterprise_benchmarks.filter((b) => b.organization_id === orgId);
  }

  public createEnterpriseBenchmark(b: EnterpriseBenchmark): EnterpriseBenchmark {
    this.data.enterprise_benchmarks.push(b);
    this.persist();
    return b;
  }

  public getReportDefinitions(orgId: string): ReportDefinition[] {
    return this.data.report_definitions.filter((r) => r.organization_id === orgId);
  }

  public createReportDefinition(r: ReportDefinition): ReportDefinition {
    this.data.report_definitions.push(r);
    this.persist();
    return r;
  }

  public getReportExecutions(orgId: string): ReportExecution[] {
    return this.data.report_executions.filter((e) => e.organization_id === orgId);
  }

  public createReportExecution(e: ReportExecution): ReportExecution {
    this.data.report_executions.push(e);
    this.persist();
    return e;
  }

  public getIntegrationProviders(): IntegrationProvider[] {
    return this.data.integration_providers;
  }

  public getIntegrationInstallations(orgId: string): IntegrationInstallation[] {
    return this.data.integration_installations.filter((i) => i.organization_id === orgId);
  }

  public createIntegrationInstallation(i: IntegrationInstallation): IntegrationInstallation {
    this.data.integration_installations.push(i);
    this.persist();
    return i;
  }

  public updateIntegrationInstallation(orgId: string, id: string, updates: Partial<IntegrationInstallation>): IntegrationInstallation {
    const idx = this.data.integration_installations.findIndex((i) => i.organization_id === orgId && i.id === id);
    if (idx === -1) throw new Error(`Integration installation not found: ${id}`);
    this.data.integration_installations[idx] = {
      ...this.data.integration_installations[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.integration_installations[idx];
  }

  public getIntegrationMappings(orgId: string, integrationId?: string): IntegrationMapping[] {
    return this.data.integration_mappings.filter(
      (m) => m.organization_id === orgId && (!integrationId || m.integration_id === integrationId)
    );
  }

  public createIntegrationMapping(m: IntegrationMapping): IntegrationMapping {
    this.data.integration_mappings.push(m);
    this.persist();
    return m;
  }

  public getIntegrationConflicts(orgId: string): IntegrationConflict[] {
    return this.data.integration_conflicts.filter((c) => c.organization_id === orgId);
  }

  public createIntegrationConflict(c: IntegrationConflict): IntegrationConflict {
    this.data.integration_conflicts.push(c);
    this.persist();
    return c;
  }

  public resolveIntegrationConflict(
    id: string,
    decision: "COMMERCEOS_ACCEPTED" | "EXTERNAL_ACCEPTED" | "MANUAL_MERGED",
    resolvedBy: string
  ): IntegrationConflict {
    const idx = this.data.integration_conflicts.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Conflict not found: ${id}`);
    this.data.integration_conflicts[idx] = {
      ...this.data.integration_conflicts[idx],
      resolved: true,
      resolution_decision: decision,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.integration_conflicts[idx];
  }

  public getIntegrationSyncs(orgId: string): IntegrationSyncRecord[] {
    return this.data.integration_syncs.filter((s) => s.organization_id === orgId);
  }

  public createIntegrationSync(s: IntegrationSyncRecord): IntegrationSyncRecord {
    this.data.integration_syncs.push(s);
    this.persist();
    return s;
  }

  public getDeveloperApplications(orgId: string): DeveloperApplication[] {
    return this.data.developer_applications.filter((a) => a.organization_id === orgId);
  }

  public createDeveloperApplication(a: DeveloperApplication): DeveloperApplication {
    this.data.developer_applications.push(a);
    this.persist();
    return a;
  }

  public getAPIKeys(orgId: string): APIKeyRecord[] {
    return this.data.api_keys.filter((k) => k.organization_id === orgId);
  }

  public createAPIKey(k: APIKeyRecord): APIKeyRecord {
    this.data.api_keys.push(k);
    this.persist();
    return k;
  }

  public findAPIKeyByPrefix(orgId: string, prefix: string): APIKeyRecord | undefined {
    return this.data.api_keys.find((k) => k.organization_id === orgId && k.key_prefix === prefix);
  }

  public getEnterpriseWebhooks(orgId: string): EnterpriseWebhookSubscription[] {
    return this.data.enterprise_webhooks.filter((w) => w.organization_id === orgId);
  }

  public createEnterpriseWebhook(w: EnterpriseWebhookSubscription): EnterpriseWebhookSubscription {
    this.data.enterprise_webhooks.push(w);
    this.persist();
    return w;
  }

  public getWebhookDeliveries(subscriptionId?: string): WebhookDeliveryRecord[] {
    return this.data.webhook_deliveries.filter((d) => !subscriptionId || d.subscription_id === subscriptionId);
  }

  public createWebhookDelivery(d: WebhookDeliveryRecord): WebhookDeliveryRecord {
    this.data.webhook_deliveries.push(d);
    this.persist();
    return d;
  }

  public getDataAssets(orgId: string): DataAsset[] {
    return this.data.data_assets.filter((a) => a.organization_id === orgId);
  }

  public createDataAsset(a: DataAsset): DataAsset {
    this.data.data_assets.push(a);
    this.persist();
    return a;
  }

  public getDataLineage(orgId: string): DataLineageTrace[] {
    return this.data.data_lineage.filter((l) => l.organization_id === orgId);
  }

  public createDataLineage(l: DataLineageTrace): DataLineageTrace {
    this.data.data_lineage.push(l);
    this.persist();
    return l;
  }

  public getDataQualityRules(orgId: string): DataQualityRule[] {
    return this.data.data_quality_rules.filter((r) => r.organization_id === orgId);
  }

  public getDataQualityIssues(orgId: string): DataQualityIssue[] {
    return this.data.data_quality_issues.filter((i) => i.organization_id === orgId);
  }

  public createDataQualityIssue(i: DataQualityIssue): DataQualityIssue {
    this.data.data_quality_issues.push(i);
    this.persist();
    return i;
  }

  public resolveDataQualityIssue(orgId: string, id: string, notes: string): DataQualityIssue {
    const idx = this.data.data_quality_issues.findIndex((i) => i.organization_id === orgId && i.id === id);
    if (idx === -1) throw new Error(`Data quality issue not found: ${id}`);
    this.data.data_quality_issues[idx] = {
      ...this.data.data_quality_issues[idx],
      status: "RESOLVED",
      resolution_notes: notes,
      resolved_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.data_quality_issues[idx];
  }

  public getEnterpriseCustomerIdentities(orgId: string): EnterpriseCustomerIdentity[] {
    return this.data.enterprise_customer_identities.filter((c) => c.organization_id === orgId);
  }

  public createEnterpriseCustomerIdentity(c: EnterpriseCustomerIdentity): EnterpriseCustomerIdentity {
    this.data.enterprise_customer_identities.push(c);
    this.persist();
    return c;
  }

  public updateEnterpriseCustomerIdentity(
    id: string,
    updates: Partial<EnterpriseCustomerIdentity>
  ): EnterpriseCustomerIdentity {
    const idx = this.data.enterprise_customer_identities.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Customer identity not found: ${id}`);
    this.data.enterprise_customer_identities[idx] = {
      ...this.data.enterprise_customer_identities[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.enterprise_customer_identities[idx];
  }

  public getEnterpriseIncidents(orgId: string): EnterpriseIncident[] {
    return this.data.enterprise_incidents.filter((i) => i.organization_id === orgId);
  }

  public createEnterpriseIncident(i: EnterpriseIncident): EnterpriseIncident {
    this.data.enterprise_incidents.push(i);
    this.persist();
    return i;
  }

  public updateEnterpriseIncident(orgId: string, id: string, updates: Partial<EnterpriseIncident>): EnterpriseIncident {
    const idx = this.data.enterprise_incidents.findIndex((i) => i.organization_id === orgId && i.id === id);
    if (idx === -1) throw new Error(`Incident not found: ${id}`);
    this.data.enterprise_incidents[idx] = {
      ...this.data.enterprise_incidents[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.enterprise_incidents[idx];
  }

  public getEnterpriseAIBudget(orgId: string, entityId?: string): EnterpriseAIBudget | undefined {
    return this.data.enterprise_ai_budgets.find(
      (b) => b.organization_id === orgId && (!entityId || b.entity_id === entityId)
    );
  }

  public upsertEnterpriseAIBudget(b: EnterpriseAIBudget): EnterpriseAIBudget {
    const idx = this.data.enterprise_ai_budgets.findIndex(
      (item) => item.organization_id === b.organization_id && item.entity_id === b.entity_id
    );
    if (idx >= 0) {
      this.data.enterprise_ai_budgets[idx] = { ...b, updated_at: new Date().toISOString() };
    } else {
      this.data.enterprise_ai_budgets.push(b);
    }
    this.persist();
    return b;
  }

  public getAIUsageRecords(orgId: string): EnterpriseAIUsageRecord[] {
    return this.data.ai_usage_records.filter((r) => r.organization_id === orgId);
  }

  public createAIUsageRecord(r: EnterpriseAIUsageRecord): EnterpriseAIUsageRecord {
    this.data.ai_usage_records.push(r);
    this.persist();
    return r;
  }

  // Phase 10 Global Event Architecture (§34)
  public publishGlobalEvent(event: GlobalEventEnvelope): GlobalEventEnvelope {
    const existing = this.data.global_events.find((e) => e.event_id === event.event_id);
    if (existing) return existing;
    this.data.global_events.push(event);
    this.persist();
    return event;
  }

  public getEventsByCorrelation(correlationId: string): GlobalEventEnvelope[] {
    return this.data.global_events
      .filter((e) => e.correlation_id === correlationId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  public replayEvents(filter: { tenantId?: string; aggregateType?: string; fromTimestamp?: string }): GlobalEventEnvelope[] {
    return this.data.global_events
      .filter((e) => {
        if (filter.tenantId && e.tenant_id !== filter.tenantId) return false;
        if (filter.aggregateType && e.aggregate_type !== filter.aggregateType) return false;
        if (filter.fromTimestamp && new Date(e.timestamp) < new Date(filter.fromTimestamp)) return false;
        return e.replay_safe !== false;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // ============================================================
  // PHASE 6: AUTOMATIONS & N8N HUB REPOSITORY METHODS
  // ============================================================

  public getAutomations(tenantId: string): AutomationRecord[] {
    return (this.data.automations || []).filter((a) => a.tenant_id === tenantId);
  }

  public findAutomationById(tenantId: string, id: string): AutomationRecord | undefined {
    return (this.data.automations || []).find((a) => a.tenant_id === tenantId && a.id === id);
  }

  public createAutomation(record: AutomationRecord): AutomationRecord {
    if (!this.data.automations) this.data.automations = [];
    this.data.automations.push(record);
    this.persist();
    return record;
  }

  public updateAutomation(tenantId: string, id: string, updates: Partial<AutomationRecord>): AutomationRecord {
    if (!this.data.automations) this.data.automations = [];
    const idx = this.data.automations.findIndex((a) => a.tenant_id === tenantId && a.id === id);
    if (idx === -1) throw new Error(`Automation not found: ${id}`);
    this.data.automations[idx] = {
      ...this.data.automations[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.automations[idx];
  }

  public deleteAutomation(tenantId: string, id: string): boolean {
    if (!this.data.automations) return false;
    const initialLen = this.data.automations.length;
    this.data.automations = this.data.automations.filter((a) => !(a.tenant_id === tenantId && a.id === id));
    this.persist();
    return this.data.automations.length < initialLen;
  }

  public getAutomationWorkflows(tenantId: string): AutomationWorkflow[] {
    return (this.data.automation_workflows || []).filter((w) => w.tenant_id === tenantId);
  }

  public findAutomationWorkflowById(tenantId: string, id: string): AutomationWorkflow | undefined {
    return (this.data.automation_workflows || []).find((w) => w.tenant_id === tenantId && w.id === id);
  }

  public createAutomationWorkflow(wf: AutomationWorkflow): AutomationWorkflow {
    if (!this.data.automation_workflows) this.data.automation_workflows = [];
    this.data.automation_workflows.push(wf);
    this.persist();
    return wf;
  }

  public updateAutomationWorkflow(tenantId: string, id: string, updates: Partial<AutomationWorkflow>): AutomationWorkflow {
    if (!this.data.automation_workflows) this.data.automation_workflows = [];
    const idx = this.data.automation_workflows.findIndex((w) => w.tenant_id === tenantId && w.id === id);
    if (idx === -1) throw new Error(`Workflow not found: ${id}`);
    this.data.automation_workflows[idx] = {
      ...this.data.automation_workflows[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.automation_workflows[idx];
  }

  public getAutomationWorkflowVersions(tenantId: string, workflowId: string): AutomationWorkflowVersion[] {
    return (this.data.automation_workflow_versions || []).filter(
      (v) => v.tenant_id === tenantId && v.workflow_id === workflowId
    );
  }

  public createAutomationWorkflowVersion(v: AutomationWorkflowVersion): AutomationWorkflowVersion {
    if (!this.data.automation_workflow_versions) this.data.automation_workflow_versions = [];
    this.data.automation_workflow_versions.push(v);
    this.persist();
    return v;
  }

  public getN8nInstances(tenantId: string): N8nInstance[] {
    return (this.data.n8n_instances || []).filter((i) => i.tenant_id === tenantId);
  }

  public findN8nInstanceById(tenantId: string, id: string): N8nInstance | undefined {
    return (this.data.n8n_instances || []).find((i) => i.tenant_id === tenantId && i.id === id);
  }

  public createN8nInstance(inst: N8nInstance): N8nInstance {
    if (!this.data.n8n_instances) this.data.n8n_instances = [];
    this.data.n8n_instances.push(inst);
    this.persist();
    return inst;
  }

  public updateN8nInstance(tenantId: string, id: string, updates: Partial<N8nInstance>): N8nInstance {
    if (!this.data.n8n_instances) this.data.n8n_instances = [];
    const idx = this.data.n8n_instances.findIndex((i) => i.tenant_id === tenantId && i.id === id);
    if (idx === -1) throw new Error(`n8n Instance not found: ${id}`);
    this.data.n8n_instances[idx] = {
      ...this.data.n8n_instances[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.n8n_instances[idx];
  }

  public getAutomationExecutions(
    tenantId: string,
    options?: { automationId?: string; status?: string; limit?: number }
  ): AutomationExecution[] {
    let list = (this.data.automation_executions || []).filter((e) => e.tenant_id === tenantId);
    if (options?.automationId) list = list.filter((e) => e.automation_id === options.automationId);
    if (options?.status) list = list.filter((e) => e.status === options.status);
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (options?.limit) list = list.slice(0, options.limit);
    return list;
  }

  public findAutomationExecutionById(tenantId: string, id: string): AutomationExecution | undefined {
    return (this.data.automation_executions || []).find((e) => e.tenant_id === tenantId && e.id === id);
  }

  public createAutomationExecution(exec: AutomationExecution): AutomationExecution {
    if (!this.data.automation_executions) this.data.automation_executions = [];
    this.data.automation_executions.push(exec);
    this.persist();
    return exec;
  }

  public updateAutomationExecution(
    tenantId: string,
    id: string,
    updates: Partial<AutomationExecution>
  ): AutomationExecution {
    if (!this.data.automation_executions) this.data.automation_executions = [];
    const idx = this.data.automation_executions.findIndex((e) => e.tenant_id === tenantId && e.id === id);
    if (idx === -1) throw new Error(`Execution not found: ${id}`);
    this.data.automation_executions[idx] = {
      ...this.data.automation_executions[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.automation_executions[idx];
  }

  public getAutomationExecutionSteps(executionId: string): AutomationExecutionStep[] {
    return (this.data.automation_execution_steps || []).filter((s) => s.execution_id === executionId);
  }

  public createAutomationExecutionStep(step: AutomationExecutionStep): AutomationExecutionStep {
    if (!this.data.automation_execution_steps) this.data.automation_execution_steps = [];
    this.data.automation_execution_steps.push(step);
    this.persist();
    return step;
  }

  public updateAutomationExecutionStep(
    id: string,
    updates: Partial<AutomationExecutionStep>
  ): AutomationExecutionStep {
    if (!this.data.automation_execution_steps) this.data.automation_execution_steps = [];
    const idx = this.data.automation_execution_steps.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Execution step not found: ${id}`);
    this.data.automation_execution_steps[idx] = {
      ...this.data.automation_execution_steps[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.automation_execution_steps[idx];
  }

  public getIdempotencyRecord(
    tenantId: string,
    idempotencyKey: string,
    operation: string
  ): IdempotencyRecord | undefined {
    return (this.data.idempotency_records || []).find(
      (r) => r.tenant_id === tenantId && r.idempotency_key === idempotencyKey && r.operation === operation
    );
  }

  public createIdempotencyRecord(rec: IdempotencyRecord): IdempotencyRecord {
    if (!this.data.idempotency_records) this.data.idempotency_records = [];
    const existing = this.getIdempotencyRecord(rec.tenant_id, rec.idempotency_key, rec.operation);
    if (existing) {
      throw new Error(`Idempotency conflict for key ${rec.idempotency_key} and operation ${rec.operation}`);
    }
    this.data.idempotency_records.push(rec);
    this.persist();
    return rec;
  }

  public updateIdempotencyRecord(tenantId: string, id: string, updates: Partial<IdempotencyRecord>): IdempotencyRecord {
    if (!this.data.idempotency_records) this.data.idempotency_records = [];
    const idx = this.data.idempotency_records.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) throw new Error(`Idempotency record not found: ${id}`);
    this.data.idempotency_records[idx] = {
      ...this.data.idempotency_records[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.idempotency_records[idx];
  }

  public getAutomationRetries(tenantId: string, status?: string): AutomationRetry[] {
    let list = (this.data.automation_retries || []).filter((r) => r.tenant_id === tenantId);
    if (status) list = list.filter((r) => r.status === status);
    return list;
  }

  public createAutomationRetry(retry: AutomationRetry): AutomationRetry {
    if (!this.data.automation_retries) this.data.automation_retries = [];
    this.data.automation_retries.push(retry);
    this.persist();
    return retry;
  }

  public updateAutomationRetry(tenantId: string, id: string, updates: Partial<AutomationRetry>): AutomationRetry {
    if (!this.data.automation_retries) this.data.automation_retries = [];
    const idx = this.data.automation_retries.findIndex((r) => r.tenant_id === tenantId && r.id === id);
    if (idx === -1) throw new Error(`Retry record not found: ${id}`);
    this.data.automation_retries[idx] = {
      ...this.data.automation_retries[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.automation_retries[idx];
  }

  public getAutomationDeadLetters(tenantId: string, status?: string): AutomationDeadLetter[] {
    let list = (this.data.automation_dead_letters || []).filter((d) => d.tenant_id === tenantId);
    if (status) list = list.filter((d) => d.status === status);
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }

  public findAutomationDeadLetterById(tenantId: string, id: string): AutomationDeadLetter | undefined {
    return (this.data.automation_dead_letters || []).find((d) => d.tenant_id === tenantId && d.id === id);
  }

  public createAutomationDeadLetter(dlq: AutomationDeadLetter): AutomationDeadLetter {
    if (!this.data.automation_dead_letters) this.data.automation_dead_letters = [];
    this.data.automation_dead_letters.push(dlq);
    this.persist();
    return dlq;
  }

  public updateAutomationDeadLetter(tenantId: string, id: string, updates: Partial<AutomationDeadLetter>): AutomationDeadLetter {
    if (!this.data.automation_dead_letters) this.data.automation_dead_letters = [];
    const idx = this.data.automation_dead_letters.findIndex((d) => d.tenant_id === tenantId && d.id === id);
    if (idx === -1) throw new Error(`Dead letter record not found: ${id}`);
    this.data.automation_dead_letters[idx] = {
      ...this.data.automation_dead_letters[idx],
      ...safePatch(updates),
    };
    this.persist();
    return this.data.automation_dead_letters[idx];
  }

  public getAutomationWebhooks(tenantId: string): AutomationWebhook[] {
    return (this.data.automation_webhooks || []).filter((w) => w.tenant_id === tenantId);
  }

  public findAutomationWebhookById(tenantId: string, id: string): AutomationWebhook | undefined {
    return (this.data.automation_webhooks || []).find((w) => w.tenant_id === tenantId && w.id === id);
  }

  /** Active webhook for a tenant + provider. Never creates one (audit C4: rows used to be auto-created for any tenant id). */
  public findAutomationWebhookByProvider(tenantId: string, provider: string): AutomationWebhook | undefined {
    return (this.data.automation_webhooks || []).find(
      (w) => w.tenant_id === tenantId && w.provider === provider && w.is_active
    );
  }

  /**
   * Server-side lookup for inbound webhook requests: resolves the row by its public id + provider.
   * The caller authenticates the request with that row's secret; the row's tenant_id is authoritative.
   */
  public findActiveAutomationWebhookForIngress(id: string, provider: string): AutomationWebhook | undefined {
    return (this.data.automation_webhooks || []).find((w) => w.id === id && w.provider === provider && w.is_active);
  }

  public createAutomationWebhook(wh: AutomationWebhook): AutomationWebhook {
    if (!this.data.automation_webhooks) this.data.automation_webhooks = [];
    this.data.automation_webhooks.push(wh);
    this.persist();
    return wh;
  }

  public updateAutomationWebhook(tenantId: string, id: string, updates: Partial<AutomationWebhook>): AutomationWebhook {
    if (!this.data.automation_webhooks) this.data.automation_webhooks = [];
    const idx = this.data.automation_webhooks.findIndex((w) => w.tenant_id === tenantId && w.id === id);
    if (idx === -1) throw new Error(`Webhook not found: ${id}`);
    this.data.automation_webhooks[idx] = {
      ...this.data.automation_webhooks[idx],
      ...safePatch(updates),
      updated_at: new Date().toISOString(),
    };
    this.persist();
    return this.data.automation_webhooks[idx];
  }

  public getAutomationWebhookDeliveries(tenantId: string, webhookId?: string): AutomationWebhookDelivery[] {
    let list = (this.data.automation_webhook_deliveries || []).filter((d) => d.tenant_id === tenantId);
    if (webhookId) list = list.filter((d) => d.webhook_id === webhookId);
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }

  public createAutomationWebhookDelivery(del: AutomationWebhookDelivery): AutomationWebhookDelivery {
    if (!this.data.automation_webhook_deliveries) this.data.automation_webhook_deliveries = [];
    this.data.automation_webhook_deliveries.push(del);
    this.persist();
    return del;
  }

  public getAutomationAuditLogs(tenantId: string, resourceId?: string): AutomationAuditRecord[] {
    let list = (this.data.automation_audit_logs || []).filter((l) => l.tenant_id === tenantId);
    if (resourceId) list = list.filter((l) => l.resource_id === resourceId);
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }

  public createAutomationAuditLog(log: AutomationAuditRecord): AutomationAuditRecord {
    if (!this.data.automation_audit_logs) this.data.automation_audit_logs = [];
    this.data.automation_audit_logs.push(log);
    this.persist();
    return log;
  }

  // ============================================================
  // CONNECTOR HUB INTEGRATION METHODS
  // ============================================================

  public getConnectors(tenantId: string, category?: string): ConnectorConfigRecord[] {
    if (!this.data.connector_configurations) this.data.connector_configurations = [];
    return this.data.connector_configurations.filter(
      (c) => c.tenant_id === tenantId && (!category || c.category === category)
    );
  }

  public findConnectorById(tenantId: string, id: string): ConnectorConfigRecord | undefined {
    if (!this.data.connector_configurations) this.data.connector_configurations = [];
    return this.data.connector_configurations.find(
      (c) => c.tenant_id === tenantId && c.id === id
    );
  }

  public findConnectorByProvider(tenantId: string, providerId: string): ConnectorConfigRecord | undefined {
    if (!this.data.connector_configurations) this.data.connector_configurations = [];
    return this.data.connector_configurations.find(
      (c) => c.tenant_id === tenantId && c.provider_id === providerId
    );
  }

  public saveConnector(config: ConnectorConfigRecord): ConnectorConfigRecord {
    if (!this.data.connector_configurations) this.data.connector_configurations = [];
    const idx = this.data.connector_configurations.findIndex(
      (c) => c.tenant_id === config.tenant_id && c.id === config.id
    );
    if (idx >= 0) {
      this.data.connector_configurations[idx] = config;
    } else {
      this.data.connector_configurations.push(config);
    }
    this.persist();
    return config;
  }

  public deleteConnector(tenantId: string, id: string): boolean {
    if (!this.data.connector_configurations) this.data.connector_configurations = [];
    const initialLen = this.data.connector_configurations.length;
    this.data.connector_configurations = this.data.connector_configurations.filter(
      (c) => !(c.tenant_id === tenantId && c.id === id)
    );
    const changed = this.data.connector_configurations.length < initialLen;
    if (changed) {
      this.persist();
    }
    return changed;
  }

  // ============================================================
  // PHASE 12: PLATFORM & SUPER ADMIN METHODS
  // ============================================================

  public getPlatformMemberships(): PlatformMembershipRecord[] {
    return this.data.platform_memberships || [];
  }

  public findPlatformMembershipByUserId(userId: string): PlatformMembershipRecord | undefined {
    return (this.data.platform_memberships || []).find((pm) => pm.user_id === userId);
  }

  public savePlatformMembership(membership: PlatformMembershipRecord): PlatformMembershipRecord {
    if (!this.data.platform_memberships) this.data.platform_memberships = [];
    const idx = this.data.platform_memberships.findIndex((pm) => pm.user_id === membership.user_id);
    if (idx >= 0) {
      this.data.platform_memberships[idx] = membership;
    } else {
      this.data.platform_memberships.push(membership);
    }
    this.persist();
    return membership;
  }

  public deletePlatformMembership(userId: string): boolean {
    if (!this.data.platform_memberships) return false;
    const initialLen = this.data.platform_memberships.length;
    this.data.platform_memberships = this.data.platform_memberships.filter((pm) => pm.user_id !== userId);
    const changed = this.data.platform_memberships.length < initialLen;
    if (changed) this.persist();
    return changed;
  }

  public getPlans(): PlanRecord[] {
    return this.data.plans || [];
  }

  public findPlanById(id: string): PlanRecord | undefined {
    return (this.data.plans || []).find((p) => p.id === id);
  }

  public savePlan(plan: PlanRecord): PlanRecord {
    if (!this.data.plans) this.data.plans = [];
    const idx = this.data.plans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) {
      this.data.plans[idx] = plan;
    } else {
      this.data.plans.push(plan);
    }
    this.persist();
    return plan;
  }

  public getPlanVersions(planId?: string): PlanVersionRecord[] {
    const versions = this.data.plan_versions || [];
    return planId ? versions.filter((v) => v.plan_id === planId) : versions;
  }

  public findPlanVersionById(id: string): PlanVersionRecord | undefined {
    return (this.data.plan_versions || []).find((v) => v.id === id);
  }

  public savePlanVersion(version: PlanVersionRecord): PlanVersionRecord {
    if (!this.data.plan_versions) this.data.plan_versions = [];
    const idx = this.data.plan_versions.findIndex((v) => v.id === version.id);
    if (idx >= 0) {
      this.data.plan_versions[idx] = version;
    } else {
      this.data.plan_versions.push(version);
    }
    this.persist();
    return version;
  }

  public getSubscriptions(): SubscriptionRecord[] {
    return this.data.subscriptions || [];
  }

  public findSubscriptionByTenantId(tenantId: string): SubscriptionRecord | undefined {
    return (this.data.subscriptions || []).find((s) => s.tenant_id === tenantId);
  }

  public saveSubscription(sub: SubscriptionRecord): SubscriptionRecord {
    if (!this.data.subscriptions) this.data.subscriptions = [];
    const idx = this.data.subscriptions.findIndex((s) => s.tenant_id === sub.tenant_id);
    if (idx >= 0) {
      this.data.subscriptions[idx] = sub;
    } else {
      this.data.subscriptions.push(sub);
    }
    this.persist();
    return sub;
  }

  public getEntitlements(): EntitlementRecord[] {
    return this.data.entitlements || [];
  }

  public findEntitlementById(id: string): EntitlementRecord | undefined {
    return (this.data.entitlements || []).find((e) => e.id === id);
  }

  public saveEntitlement(entitlement: EntitlementRecord): EntitlementRecord {
    if (!this.data.entitlements) this.data.entitlements = [];
    const idx = this.data.entitlements.findIndex((e) => e.id === entitlement.id);
    if (idx >= 0) {
      this.data.entitlements[idx] = entitlement;
    } else {
      this.data.entitlements.push(entitlement);
    }
    this.persist();
    return entitlement;
  }

  public getTenantEntitlements(tenantId: string): TenantEntitlementRecord[] {
    return (this.data.tenant_entitlements || []).filter((te) => te.tenant_id === tenantId);
  }

  public findTenantEntitlement(tenantId: string, entitlementId: string): TenantEntitlementRecord | undefined {
    return (this.data.tenant_entitlements || []).find(
      (te) => te.tenant_id === tenantId && te.entitlement_id === entitlementId
    );
  }

  public saveTenantEntitlement(record: TenantEntitlementRecord): TenantEntitlementRecord {
    if (!this.data.tenant_entitlements) this.data.tenant_entitlements = [];
    const idx = this.data.tenant_entitlements.findIndex(
      (te) => te.tenant_id === record.tenant_id && te.entitlement_id === record.entitlement_id
    );
    if (idx >= 0) {
      this.data.tenant_entitlements[idx] = record;
    } else {
      this.data.tenant_entitlements.push(record);
    }
    this.persist();
    return record;
  }

  public getUsageRecords(tenantId?: string): UsageRecordRecord[] {
    const list = this.data.usage_records || [];
    return tenantId ? list.filter((u) => u.tenant_id === tenantId) : list;
  }

  public saveUsageRecord(record: UsageRecordRecord): UsageRecordRecord {
    if (!this.data.usage_records) this.data.usage_records = [];
    const idx = this.data.usage_records.findIndex(
      (u) =>
        u.tenant_id === record.tenant_id &&
        u.entitlement_id === record.entitlement_id &&
        u.period_start === record.period_start
    );
    if (idx >= 0) {
      this.data.usage_records[idx] = record;
    } else {
      this.data.usage_records.push(record);
    }
    this.persist();
    return record;
  }

  public getPlatformFeatureFlags(): PlatformFeatureFlagRecord[] {
    return this.data.platform_feature_flags || [];
  }

  public findPlatformFeatureFlag(key: string): PlatformFeatureFlagRecord | undefined {
    return (this.data.platform_feature_flags || []).find((f) => f.key === key);
  }

  public savePlatformFeatureFlag(flag: PlatformFeatureFlagRecord): PlatformFeatureFlagRecord {
    if (!this.data.platform_feature_flags) this.data.platform_feature_flags = [];
    const idx = this.data.platform_feature_flags.findIndex((f) => f.id === flag.id || f.key === flag.key);
    if (idx >= 0) {
      this.data.platform_feature_flags[idx] = flag;
    } else {
      this.data.platform_feature_flags.push(flag);
    }
    this.persist();
    return flag;
  }

  public getPlatformSettings(): PlatformSettingRecord[] {
    return this.data.platform_settings || [];
  }

  public findPlatformSetting(key: string): PlatformSettingRecord | undefined {
    return (this.data.platform_settings || []).find((s) => s.key === key);
  }

  public savePlatformSetting(
    setting: PlatformSettingRecord,
    changedByUserId?: string,
    reason?: string
  ): PlatformSettingRecord {
    if (!this.data.platform_settings) this.data.platform_settings = [];
    const idx = this.data.platform_settings.findIndex((s) => s.key === setting.key);
    if (idx >= 0) {
      this.data.platform_settings[idx] = setting;
    } else {
      this.data.platform_settings.push(setting);
    }

    if (changedByUserId) {
      if (!this.data.platform_setting_versions) this.data.platform_setting_versions = [];
      this.data.platform_setting_versions.push({
        id: `set_ver_${randomSuffix()}`,
        setting_key: setting.key,
        value: setting.value,
        changed_by_user_id: changedByUserId,
        reason: reason || "Setting updated via Control Plane",
        created_at: new Date().toISOString(),
      });
    }

    this.persist();
    return setting;
  }

  public getPlatformSettingVersions(key?: string): PlatformSettingVersionRecord[] {
    const list = this.data.platform_setting_versions || [];
    return key ? list.filter((v) => v.setting_key === key) : list;
  }

  public getPlatformIncidents(): PlatformIncidentRecord[] {
    return this.data.platform_incidents || [];
  }

  public findPlatformIncidentById(id: string): PlatformIncidentRecord | undefined {
    return (this.data.platform_incidents || []).find((inc) => inc.id === id);
  }

  public savePlatformIncident(incident: PlatformIncidentRecord): PlatformIncidentRecord {
    if (!this.data.platform_incidents) this.data.platform_incidents = [];
    const idx = this.data.platform_incidents.findIndex((i) => i.id === incident.id);
    if (idx >= 0) {
      this.data.platform_incidents[idx] = incident;
    } else {
      this.data.platform_incidents.unshift(incident);
    }
    this.persist();
    return incident;
  }

  public getPlatformMaintenanceWindows(): PlatformMaintenanceWindowRecord[] {
    return this.data.platform_maintenance_windows || [];
  }

  public savePlatformMaintenanceWindow(window: PlatformMaintenanceWindowRecord): PlatformMaintenanceWindowRecord {
    if (!this.data.platform_maintenance_windows) this.data.platform_maintenance_windows = [];
    const idx = this.data.platform_maintenance_windows.findIndex((w) => w.id === window.id);
    if (idx >= 0) {
      this.data.platform_maintenance_windows[idx] = window;
    } else {
      this.data.platform_maintenance_windows.push(window);
    }
    this.persist();
    return window;
  }

  public getPlatformAuditLogs(filters?: {
    actorId?: string;
    tenantId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): { logs: PlatformAuditLogRecord[]; total: number } {
    let list = [...(this.data.platform_audit_logs || [])];
    if (filters?.actorId) list = list.filter((l) => l.actor_id === filters.actorId);
    if (filters?.tenantId) list = list.filter((l) => l.target_tenant_id === filters.tenantId);
    if (filters?.action) list = list.filter((l) => l.action.toLowerCase().includes(filters.action!.toLowerCase()));

    const total = list.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    const logs = list.slice(offset, offset + limit);
    return { logs, total };
  }

  // Append-only invariant: Never allow mutation of existing audit entries
  public appendPlatformAuditLog(log: PlatformAuditLogRecord): PlatformAuditLogRecord {
    if (!this.data.platform_audit_logs) this.data.platform_audit_logs = [];
    this.data.platform_audit_logs.unshift(log);
    this.persist();
    return log;
  }

  public getPlatformKillSwitches(): PlatformKillSwitchRecord[] {
    return this.data.platform_kill_switches || [];
  }

  public findPlatformKillSwitch(id: string): PlatformKillSwitchRecord | undefined {
    return (this.data.platform_kill_switches || []).find((k) => k.id === id);
  }

  public savePlatformKillSwitch(killSwitch: PlatformKillSwitchRecord): PlatformKillSwitchRecord {
    if (!this.data.platform_kill_switches) this.data.platform_kill_switches = [];
    const idx = this.data.platform_kill_switches.findIndex((k) => k.id === killSwitch.id);
    if (idx >= 0) {
      this.data.platform_kill_switches[idx] = killSwitch;
    } else {
      this.data.platform_kill_switches.push(killSwitch);
    }
    this.persist();
    return killSwitch;
  }

  public getPlatformSecurityEvents(limit = 100): PlatformSecurityEventRecord[] {
    const events = this.data.platform_security_events || [];
    return events.slice(0, limit);
  }

  public recordPlatformSecurityEvent(event: PlatformSecurityEventRecord): PlatformSecurityEventRecord {
    if (!this.data.platform_security_events) this.data.platform_security_events = [];
    this.data.platform_security_events.unshift(event);
    this.persist();
    return event;
  }

  public getPlatformAnnouncements(): PlatformAnnouncementRecord[] {
    return this.data.platform_announcements || [];
  }

  public savePlatformAnnouncement(announcement: PlatformAnnouncementRecord): PlatformAnnouncementRecord {
    if (!this.data.platform_announcements) this.data.platform_announcements = [];
    const idx = this.data.platform_announcements.findIndex((a) => a.id === announcement.id);
    if (idx >= 0) {
      this.data.platform_announcements[idx] = announcement;
    } else {
      this.data.platform_announcements.unshift(announcement);
    }
    this.persist();
    return announcement;
  }

  public getPlatformApiKeys(): PlatformApiKeyRecord[] {
    return this.data.platform_api_keys || [];
  }

  public savePlatformApiKey(key: PlatformApiKeyRecord): PlatformApiKeyRecord {
    if (!this.data.platform_api_keys) this.data.platform_api_keys = [];
    const idx = this.data.platform_api_keys.findIndex((k) => k.id === key.id);
    if (idx >= 0) {
      this.data.platform_api_keys[idx] = key;
    } else {
      this.data.platform_api_keys.push(key);
    }
    this.persist();
    return key;
  }

  public getImpersonationSessions(): ImpersonationSessionRecord[] {
    return this.data.impersonation_sessions || [];
  }

  public findImpersonationSessionById(id: string): ImpersonationSessionRecord | undefined {
    return (this.data.impersonation_sessions || []).find((s) => s.id === id);
  }

  public saveImpersonationSession(session: ImpersonationSessionRecord): ImpersonationSessionRecord {
    if (!this.data.impersonation_sessions) this.data.impersonation_sessions = [];
    const idx = this.data.impersonation_sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.data.impersonation_sessions[idx] = session;
    } else {
      this.data.impersonation_sessions.unshift(session);
    }
    this.persist();
    return session;
  }
}

/**
 * One store per process (FX-24): Next.js can evaluate this module more than once (dev reloads, separate route bundles).
 * Two instances would each hold their own copy of the data and overwrite each other's writes.
 */
const globalStore = globalThis as typeof globalThis & {
  __commerceosDb?: CommerceDatabase;
  __commerceosDbShutdownHooked?: boolean;
  /**
   * Set before this module loads by in-process code only: the test runner's Postgres mode (tests/support/pg-test-store.ts)
   * and the backfill scripts' read-only JSON source (scripts/lib/read-json-store.ts). No request can reach it.
   */
  __commerceosDbFactory?: (store: typeof CommerceDatabase) => CommerceDatabase;
};
export const db: CommerceDatabase =
  globalStore.__commerceosDb ??
  (globalStore.__commerceosDb = globalStore.__commerceosDbFactory?.(CommerceDatabase) ?? new CommerceDatabase({ serverMode: true }));

if (!globalStore.__commerceosDbShutdownHooked && process.env.NODE_ENV !== "test") {
  globalStore.__commerceosDbShutdownHooked = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void db.shutdown().finally(() => process.exit(0));
    });
  }
}
