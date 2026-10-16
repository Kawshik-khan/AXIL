/**
 * Typed platform settings registry (super-admin console plan J2). Every customizable platform setting is declared here
 * once: its schema and bounds, its code default, where it may be overridden, its risk tier and — most importantly —
 * the code that reads it. A setting nobody reads is not editable (`readBy: null`), so the console never offers a
 * control that changes nothing. Pure data: safe to import from client components.
 */
import { z } from "zod";

export type SettingCategory =
  | "BILLING"
  | "TRIALS"
  | "AI"
  | "SECURITY"
  | "RATE_LIMITS"
  | "NOTIFICATIONS"
  | "OPERATIONS"
  | "N8N_CLUSTER"
  | "STORAGE"
  | "FINANCE";

export type SettingRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SettingSpec<T = unknown> {
  key: string;
  label: string;
  description: string;
  category: SettingCategory;
  schema: z.ZodType<T>;
  /** The value that applies when nothing is stored (non-negotiable 6: business config lives in code constants). */
  default: T;
  unit?: string;
  risk: SettingRisk;
  sensitive: boolean;
  /** The code that consumes the value; null means nothing reads it yet, so it can't be edited. */
  readBy: string | null;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const SETTINGS_REGISTRY: readonly SettingSpec[] = [
  {
    key: "billing.past_due_grace_days",
    label: "Past-due grace period",
    description: "Days a PAST_DUE subscription keeps its plan limits after the period ends; afterwards global defaults apply.",
    category: "BILLING",
    schema: int(0, 60),
    default: 7,
    unit: "days",
    risk: "HIGH",
    sensitive: false,
    readBy: "PlatformEntitlementService.planAppliesTo",
  },
  {
    key: "billing.trial_default_days",
    label: "Default trial length",
    description: "Trial length for a new trial subscription when its plan version does not set trial days.",
    category: "TRIALS",
    schema: int(0, 90),
    default: 14,
    unit: "days",
    risk: "MEDIUM",
    sensitive: false,
    readBy: "PlatformSubscriptionService.startTrial",
  },
  {
    key: "billing.trial_max_extension_days",
    label: "Maximum trial extension",
    description: "The furthest an operator may push a trial's end date in one extension.",
    category: "TRIALS",
    schema: int(1, 90),
    default: 30,
    unit: "days",
    risk: "MEDIUM",
    sensitive: false,
    readBy: "PlatformSubscriptionService.extendTrial",
  },
  {
    key: "plans.migration_approval_threshold",
    label: "Plan migration approval threshold",
    description: "Moving more tenants than this between plan versions needs a second operator's approval.",
    category: "BILLING",
    schema: int(0, 100_000),
    default: 10,
    unit: "tenants",
    risk: "HIGH",
    sensitive: false,
    readBy: "PlatformPlanService.migrate",
  },
  {
    key: "finance.usd_to_bdt_rate",
    label: "USD → BDT conversion rate",
    description: "Used only where an AI provider reports cost in USD and no BDT cost was recorded.",
    category: "FINANCE",
    schema: z.number().positive().max(10_000),
    default: 120,
    unit: "BDT per USD",
    risk: "MEDIUM",
    sensitive: false,
    readBy: "PlatformAnalyticsService.getPlatformOverview",
  },
  {
    key: "attention.entitlement_threshold_pct",
    label: "Limit warning threshold",
    description: "A tenant appears in the Control Tower inbox when its usage reaches this share of a limit.",
    category: "OPERATIONS",
    schema: int(50, 100),
    default: 90,
    unit: "%",
    risk: "LOW",
    sensitive: false,
    readBy: "PlatformAttentionService.list",
  },
  {
    key: "attention.security_event_window_hours",
    label: "Security event window",
    description: "HIGH and CRITICAL security events newer than this appear in the Control Tower inbox.",
    category: "OPERATIONS",
    schema: int(1, 720),
    default: 24,
    unit: "hours",
    risk: "LOW",
    sensitive: false,
    readBy: "PlatformAttentionService.list",
  },
  {
    key: "approvals.expiry_minutes",
    label: "Approval request lifetime",
    description: "How long a two-person approval request stays valid before it expires unused.",
    category: "SECURITY",
    schema: int(5, 1440),
    default: 60,
    unit: "minutes",
    risk: "HIGH",
    sensitive: false,
    readBy: "PlatformApprovalService.request",
  },
  // Seeded before the registry existed; no code reads them yet, so they are listed but not editable.
  {
    key: "security.mfa_enforced",
    label: "Require MFA for operators",
    description: "Operator sign-in already requires TOTP when the operator has enrolled; this flag is not read.",
    category: "SECURITY",
    schema: z.boolean(),
    default: true,
    risk: "CRITICAL",
    sensitive: false,
    readBy: null,
  },
  {
    key: "security.privileged_session_lifetime_seconds",
    label: "Privileged session lifetime",
    description: "Platform session lifetime is set in src/lib/security.ts; this value is not read.",
    category: "SECURITY",
    schema: int(300, 86_400),
    default: 3600,
    unit: "seconds",
    risk: "CRITICAL",
    sensitive: false,
    readBy: null,
  },
  {
    key: "automation.max_concurrency_global",
    label: "Global automation concurrency",
    description: "Not read by the automation worker yet.",
    category: "N8N_CLUSTER",
    schema: int(1, 10_000),
    default: 100,
    risk: "HIGH",
    sensitive: false,
    readBy: null,
  },
  {
    key: "rate_limits.platform_api_rpm",
    label: "Platform API rate limit",
    description: "Not read by src/lib/rate-limit.ts yet.",
    category: "RATE_LIMITS",
    schema: int(10, 100_000),
    default: 1200,
    unit: "requests/min",
    risk: "HIGH",
    sensitive: false,
    readBy: null,
  },
];

export function findSettingSpec(key: string): SettingSpec | undefined {
  return SETTINGS_REGISTRY.find((s) => s.key === key);
}

/** Validates a value for a registered, enforced setting; throws a descriptive Error otherwise. */
export function validateSettingValue(key: string, value: unknown): unknown {
  const spec = findSettingSpec(key);
  if (!spec) throw new Error(`"${key}" is not a registered platform setting.`);
  if (!spec.readBy) throw new Error(`"${key}" is not read by any code yet, so it can't be changed.`);
  const parsed = spec.schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; ") || `Invalid value for "${key}".`);
  }
  return parsed.data;
}
