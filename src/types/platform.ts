import { PlatformRole, PlatformPermission } from "@/lib/context";

export interface PlatformMembershipRecord {
  id: string;
  user_id: string;
  role: PlatformRole;
  /** True only after the operator confirmed a TOTP code (FX-15); never a default. */
  mfa_enabled: boolean;
  /** Legacy plaintext field; unused. */
  mfa_secret?: string;
  /** TOTP secret, encrypted with CREDENTIALS_ENCRYPTION_KEY. */
  mfa_secret_encrypted?: string;
  /** Secret issued by /mfa/enroll, waiting for /mfa/confirm. */
  mfa_pending_secret_encrypted?: string;
  /** Last accepted TOTP time-step, so a code can't be replayed inside its window. */
  mfa_last_step?: number;
  mfa_enrolled_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformPermissionRecord {
  id: PlatformPermission;
  category: "TENANT" | "BILLING" | "AUTOMATION" | "INFRASTRUCTURE" | "SECURITY" | "AUDIT" | "SETTINGS" | "SUPPORT" | "ANALYTICS";
  description: string;
  created_at: string;
}

export interface PlatformRolePermissionRecord {
  role: PlatformRole;
  permission_id: PlatformPermission;
}

export interface ImpersonationSessionRecord {
  id: string;
  operator_user_id: string;
  target_tenant_id: string;
  target_user_id: string;
  reason: string;
  ticket_reference?: string;
  mode: "READ_ONLY" | "MUTATION_APPROVED";
  step_up_verified_at: string;
  expires_at: string;
  revoked_at?: string;
  revoked_by_user_id?: string;
  created_at: string;
}

export interface PlanRecord {
  id: string; // 'FREE', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'
  name: string;
  description: string;
  is_active: boolean;
  /** PUBLIC: offered to every workspace; HIDDEN: assignable by operators only; PRIVATE: a custom deal for named tenants. Absent = PUBLIC. */
  visibility?: "PUBLIC" | "HIDDEN" | "PRIVATE";
  /** Tenants a PRIVATE plan is offered to. */
  private_tenant_ids?: string[];
  display_order?: number;
  /** Operator-entered marketing label, e.g. "Most popular". */
  highlight_label?: string;
  created_at: string;
  updated_at: string;
}

export interface PlanVersionRecord {
  id: string;
  plan_id: string;
  version: number;
  /** Legacy single price: kept in sync for older readers; new versions carry monthly/annual prices below. */
  billing_period: "MONTHLY" | "ANNUAL";
  price_bdt: number;
  features: Record<string, unknown>;
  /** Legacy flag, kept equal to status === "PUBLISHED". */
  is_published: boolean;
  /** Absent on legacy versions: derived from is_published. Published versions are immutable. */
  status?: "DRAFT" | "PUBLISHED" | "RETIRED";
  monthly_price_bdt?: number | null;
  annual_price_bdt?: number | null;
  trial_days?: number | null;
  setup_fee_bdt?: number | null;
  change_note?: string;
  created_by?: string;
  published_by?: string;
  published_at?: string;
  retired_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface SubscriptionRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_version_id: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
  /** Which price of the plan version the tenant pays; absent = the version's legacy billing_period. */
  billing_period?: "MONTHLY" | "ANNUAL";
  trial_ends_at?: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface EntitlementRecord {
  id: string; // 'orders.monthly_limit', 'channels.max_connected', etc.
  name: string;
  value_type: "NUMERIC" | "BOOLEAN" | "TIER";
  default_value: unknown;
  created_at: string;
}

export interface TenantEntitlementRecord {
  tenant_id: string;
  entitlement_id: string;
  value: unknown;
  is_override: boolean;
  override_reason?: string;
  /** After this instant the override no longer applies (derived on read; nothing is rewritten). */
  expires_at?: string;
  granted_by?: string;
  ticket_ref?: string;
  updated_at: string;
}

export interface UsageRecordRecord {
  id: string;
  tenant_id: string;
  entitlement_id: string;
  period_start: string;
  period_end: string;
  quantity_used: number;
  recorded_at: string;
}

export interface PlatformFeatureFlagRecord {
  id: string;
  key: string;
  description: string;
  is_enabled_globally: boolean;
  percentage_rollout: number;
  scope: "GLOBAL" | "TENANT" | "USER" | "ENVIRONMENT";
  tenant_allowlist: string[];
  rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PlatformSettingRecord {
  key: string;
  value: unknown;
  /** Registry categories (src/domains/platform/settings-registry.ts) plus the legacy AI_MODELS. */
  category:
    | "AI_MODELS"
    | "AI"
    | "SECURITY"
    | "STORAGE"
    | "RATE_LIMITS"
    | "NOTIFICATIONS"
    | "BILLING"
    | "TRIALS"
    | "OPERATIONS"
    | "FINANCE";
  description: string;
  is_sensitive: boolean;
  updated_at: string;
}

export interface PlatformSettingVersionRecord {
  id: string;
  setting_key: string;
  value: unknown;
  changed_by_user_id: string;
  reason: string;
  created_at: string;
}

/**
 * Content-Security-Policy violation reports (FX-86), counted per day, directive and blocked origin; the browser's report
 * itself (page URLs, samples) is not kept. Platform scope.
 */
export interface CspReportRecord {
  /** `<day>|<directive>|<blocked origin>` */
  id: string;
  day: string;
  directive: string;
  blocked: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PlatformIncidentRecord {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
  status: "OPEN" | "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "MITIGATING" | "RESOLVED" | "CLOSED";
  affected_components: string[];
  impact_summary?: string;
  started_at: string;
  resolved_at?: string;
  owner?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformMaintenanceWindowRecord {
  id: string;
  title: string;
  description: string;
  scheduled_start: string;
  scheduled_end: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  allowed_roles: PlatformRole[];
  read_only_mode: boolean;
  created_at: string;
}

export interface PlatformAuditLogRecord {
  id: string;
  actor_id: string;
  effective_actor_id?: string;
  platform_role: PlatformRole;
  target_tenant_id?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILED" | "BLOCKED";
  error_message?: string;
  request_id: string;
  correlation_id: string;
  impersonation_session_id?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface PlatformKillSwitchRecord {
  id: string;
  scope: "GLOBAL" | "TENANT" | "WORKFLOW" | "PROVIDER" | "CHANNEL" | "ENVIRONMENT";
  target_id?: string;
  is_active: boolean;
  reason: string;
  activated_by_user_id: string;
  activated_at?: string;
  deactivated_by_user_id?: string;
  deactivated_at?: string;
  updated_at: string;
}

export interface PlatformSecurityEventRecord {
  id: string;
  event_type: "FAILED_LOGIN" | "SUSPICIOUS_SESSION" | "MFA_FAILURE" | "PRIVILEGED_ACTION" | "KILL_SWITCH_TRIGGERED" | "IMPERSONATION_STARTED" | "RATE_LIMIT_EXCEEDED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  actor_id?: string;
  target_tenant_id?: string;
  description: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface PlatformAnnouncementRecord {
  id: string;
  title: string;
  message: string;
  announcement_type: "INFO" | "WARNING" | "MAINTENANCE" | "INCIDENT" | "FEATURE";
  target_scope: "ALL_TENANTS" | "PLAN" | "TENANT_LIST" | "USER_SEGMENT";
  target_filter?: Record<string, unknown>;
  is_published: boolean;
  published_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string; // e.g. "pk_live_xxxx" (full secret is hashed)
  hashed_secret: string;
  scope: PlatformRole;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

/** Two-person approval for privileged platform actions (super-admin console plan §5.5). Platform scope. */
export type PlatformApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXECUTED";

export interface PlatformApprovalRequestRecord {
  id: string;
  /** A key from src/domains/platform/privileged-actions.ts. */
  action_key: string;
  target_type: string;
  target_id: string;
  target_tenant_id?: string;
  /** Human-readable target, captured when requested (e.g. the tenant name). */
  target_label: string;
  /** The exact action input the approval covers (sanitized; no secrets). */
  payload: Record<string, unknown>;
  /** SHA-256 of the canonical payload; execution must present the same payload. */
  payload_hash: string;
  reason: string;
  ticket_ref?: string;
  requested_by: string;
  requested_by_role: PlatformRole;
  requested_at: string;
  /** Expiry is derived on read (now > expires_at); the status is not rewritten. */
  expires_at: string;
  status: PlatformApprovalStatus;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  executed_at?: string;
  executed_request_id?: string;
}

/** A purchasable or grantable increment to one entitlement (plan C3). */
export interface PlatformAddonRecord {
  id: string;
  name: string;
  description: string;
  entitlement_id: string;
  /** How much one unit adds to the entitlement's numeric limit. */
  increment: number;
  /** null until the billing engine can charge for add-ons. */
  monthly_price_bdt: number | null;
  status: "ACTIVE" | "RETIRED";
  /** Empty = available on every plan. */
  allowed_plan_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** An add-on granted to a tenant. Active while starts_at <= now < ends_at (derived on read) and not revoked. */
export interface TenantAddonRecord {
  id: string;
  tenant_id: string;
  addon_id: string;
  quantity: number;
  source: "PURCHASED" | "COMPLIMENTARY";
  starts_at: string;
  ends_at?: string;
  granted_by: string;
  reason: string;
  ticket_ref?: string;
  revoked_at?: string;
  revoked_by?: string;
  created_at: string;
}
