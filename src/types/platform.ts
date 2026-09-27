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
  created_at: string;
  updated_at: string;
}

export interface PlanVersionRecord {
  id: string;
  plan_id: string;
  version: number;
  billing_period: "MONTHLY" | "ANNUAL";
  price_bdt: number;
  features: Record<string, unknown>;
  is_published: boolean;
  created_at: string;
}

export interface SubscriptionRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_version_id: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
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
  category: "AI_MODELS" | "SECURITY" | "STORAGE" | "N8N_CLUSTER" | "RATE_LIMITS" | "NOTIFICATIONS";
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
