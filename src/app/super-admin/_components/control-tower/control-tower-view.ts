import type { AttentionItem, AttentionSeverity } from "@/domains/platform/services/platform-attention.service";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import { findPrivilegedAction, type PrivilegedActionSpec } from "@/domains/platform/privileged-actions";
import type { ImpersonationSessionRecord, PlatformIncidentRecord } from "@/types/platform";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatCount, formatDateTime, formatPercent, formatRelative, humanize, isPresent, NO_DATA } from "../../_lib/format";

/** Pure helpers for the Control Tower. They arrange what the API returned; a missing value stays missing. */

export const SEVERITIES: readonly AttentionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const CATEGORY_LABEL: Record<AttentionItem["category"], string> = {
  INCIDENT: "Incident",
  KILL_SWITCH: "Kill switch",
  LIMIT: "Limit",
  DEAD_LETTER: "Dead letter",
  HITL: "Handover",
  APPROVAL: "Approval",
  SECURITY: "Security",
  SUPPORT: "Support",
};

const CTA: Record<AttentionItem["category"], string> = {
  INCIDENT: "Open incidents",
  KILL_SWITCH: "Open Safety",
  LIMIT: "Open usage",
  DEAD_LETTER: "Open dead letters",
  HITL: "Open the handover queue",
  APPROVAL: "Review the requests",
  SECURITY: "Open operators",
  SUPPORT: "Open support sessions",
};

export function categoryLabel(item: AttentionItem): string {
  return CATEGORY_LABEL[item.category];
}

export function ctaLabel(item: AttentionItem): string {
  return item.href.startsWith(`${CONSOLE_ROOT}/audit`) ? "Open the audit log" : CTA[item.category];
}

export function countBySeverity(items: readonly AttentionItem[]): Record<AttentionSeverity, number> {
  const counts: Record<AttentionSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const item of items) counts[item.severity]++;
  return counts;
}

/** Conditions the service works out on each read: their `observed_at` is that read, not when they began. */
function isComputed(item: AttentionItem): boolean {
  return item.category === "LIMIT" || item.id === "operators:no_mfa";
}

/** How long ago, or that the item only describes the state right now. */
export function ageLabel(item: AttentionItem, now: number = Date.now()): string {
  return isComputed(item) ? "Right now" : formatRelative(item.observed_at, now);
}

/** The earliest start among the items that have one (security items carry their latest event, not a start). */
export function oldestStart(items: readonly AttentionItem[]): string | null {
  const starts = items.filter((i) => !isComputed(i) && i.category !== "SECURITY").map((i) => i.observed_at);
  return starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null;
}

export function headline(count: number): string {
  if (count === 0) return "Nothing needs attention";
  return count === 1 ? "1 item needs attention" : `${formatCount(count)} items need attention`;
}

const ACTION_KEYS: Record<AttentionItem["category"], readonly string[]> = {
  INCIDENT: ["incident.update"],
  KILL_SWITCH: ["kill_switch.deactivate"],
  LIMIT: ["addon.grant", "subscription.change_plan", "entitlement.override"],
  DEAD_LETTER: ["dlq.retry", "dlq.resolve"],
  HITL: ["ai.hitl.takeover"],
  APPROVAL: ["approval.decide"],
  SECURITY: [],
  SUPPORT: ["support.revoke"],
};

/** The actions that resolve an item, from the registry the server enforces; empty when it needs no privileged action. */
export function actionsFor(item: AttentionItem): PrivilegedActionSpec[] {
  // The attention service marks a GLOBAL switch CRITICAL and every scoped one HIGH
  const keys =
    item.category === "KILL_SWITCH" && item.severity === "CRITICAL" ? ["kill_switch.deactivate_global"] : ACTION_KEYS[item.category];
  return keys.flatMap((key) => findPrivilegedAction(key) ?? []);
}

/** What one action asks the operator for besides the permission, in words. */
export function requirementsOf(spec: PrivilegedActionSpec): string[] {
  return [
    ...(spec.stepUp ? ["authenticator code"] : []),
    ...(spec.reasonMin > 0 ? ["reason"] : []),
    ...(spec.ticketRequired ? ["ticket"] : []),
    ...(spec.approval === "never" ? [] : [spec.approval === "always" ? "approval" : "approval in some cases"]),
    ...(spec.confirmPhrase ? ["typed confirmation"] : []),
  ];
}

// ---------------------------------------------------------------- the records behind an item

interface HandoverRow {
  id: string;
  tenant_name: string;
  priority: string;
  status: string;
  trigger_reason: string;
  sla_due_at: string;
}

interface OperatorRow {
  id: string;
  name: string;
  email: string;
  role: string;
  mfa_enabled: boolean;
  is_active: boolean;
}

export interface AttentionRecord {
  id: string;
  title: string;
  note: string;
  when: string;
}

/** The existing read route that lists the records behind an item; null when the item already says everything. */
export function recordsUrl(item: AttentionItem): string | null {
  switch (item.category) {
    case "INCIDENT":
      return "/api/v1/platform/incidents";
    case "APPROVAL":
      return "/api/v1/platform/approvals?status=PENDING&limit=100";
    case "HITL":
      return "/api/v1/platform/ai/hitl/queue";
    case "SUPPORT":
      return "/api/v1/platform/support/impersonate";
    case "SECURITY":
      return item.id === "operators:no_mfa" ? "/api/v1/platform/users" : null;
    default:
      return null;
  }
}

/** The rows of `recordsUrl(item)` that belong to this item, with the same filters the attention service used. */
export function toRecords(item: AttentionItem, data: unknown, now: number = Date.now()): AttentionRecord[] {
  switch (item.category) {
    case "INCIDENT":
      return (data as PlatformIncidentRecord[])
        .filter((i) => `incident:${i.id}` === item.id)
        .map((i) => ({
          id: i.id,
          title: `Started ${formatDateTime(i.started_at)}`,
          note: i.impact_summary || "No impact summary recorded",
          when: i.owner ? `Owner ${i.owner}` : "No owner",
        }));
    case "APPROVAL":
      return (data as ApprovalView[])
        .filter((a) => Date.parse(a.expires_at) > now)
        .map((a) => ({
          id: a.id,
          title: a.action_label,
          note: `${a.target_label} · asked by ${humanize(a.requested_by_role)} ${formatRelative(a.requested_at, now)} · ${a.can_decide ? "you can decide it" : "not yours to decide"}`,
          when: `Expires ${formatDateTime(a.expires_at)}`,
        }));
    case "HITL":
      return (data as { escalations: HandoverRow[] }).escalations
        .filter((e) => e.status === "PENDING_REVIEW" && Date.parse(e.sla_due_at) < now)
        .map((e) => ({
          id: e.id,
          title: e.tenant_name,
          note: `${humanize(e.priority)} priority · ${e.trigger_reason}`,
          when: `Due ${formatRelative(e.sla_due_at, now)}`,
        }));
    case "SUPPORT":
      return (data as ImpersonationSessionRecord[])
        .filter((s) => !s.revoked_at && Date.parse(s.expires_at) > now)
        .map((s) => ({
          id: s.id,
          title: s.target_tenant_id,
          note: `${s.mode === "READ_ONLY" ? "Read-only" : humanize(s.mode)} · ${s.reason}`,
          when: `Ends ${formatDateTime(s.expires_at)}`,
        }));
    case "SECURITY":
      return (data as OperatorRow[])
        .filter((o) => o.is_active && !o.mfa_enabled)
        .map((o) => ({ id: o.id, title: o.name, note: o.email, when: humanize(o.role) }));
    default:
      return [];
  }
}

// ---------------------------------------------------------------- posture band

export type GateTone = "ok" | "warn" | "bad" | "info" | "none";

export interface PostureGate {
  label: string;
  value: string;
  state: string;
  tone: GateTone;
  href: string;
}

/** The five gates. `items` is null until the attention list has loaded; a count only it knows is then not shown. */
export function postureGates(o: PlatformOverviewMetrics, items: readonly AttentionItem[] | null): PostureGate[] {
  const switches = items?.filter((i) => i.category === "KILL_SWITCH").length;
  const approvals = items ? (items.find((i) => i.category === "APPROVAL")?.count ?? 0) : null;
  const on = o.infrastructure.kill_switch_active;
  const incidents = o.infrastructure.open_incidents_count;
  const sessions = o.security.active_impersonation_sessions;
  const mfa = o.security.mfa_enforced_percent;
  return [
    {
      label: "Kill switches",
      value: !on ? formatCount(0) : switches ? formatCount(switches) : "On",
      state: on ? "Active" : "None active",
      tone: on ? "bad" : "ok",
      href: `${CONSOLE_ROOT}/safety`,
    },
    {
      label: "Open incidents",
      value: formatCount(incidents),
      state: incidents > 0 ? "Not resolved" : "None open",
      tone: incidents > 0 ? "bad" : "ok",
      href: `${CONSOLE_ROOT}/safety?tab=incidents`,
    },
    {
      label: "Approvals",
      value: approvals === null ? "–" : formatCount(approvals),
      state: approvals === null ? "Not loaded" : approvals > 0 ? "Waiting" : "None waiting",
      tone: approvals === null ? "none" : approvals > 0 ? "warn" : "ok",
      href: `${CONSOLE_ROOT}/security?tab=approvals`,
    },
    {
      label: "Support sessions",
      value: formatCount(sessions),
      state: sessions > 0 ? "In progress" : "None active",
      tone: sessions > 0 ? "info" : "ok",
      href: `${CONSOLE_ROOT}/security?tab=support`,
    },
    {
      label: "Operators with MFA",
      value: isPresent(mfa) ? formatPercent(mfa, 0) : "–",
      state: !isPresent(mfa) ? "No active operators" : mfa >= 100 ? "All active operators" : "Some without MFA",
      tone: !isPresent(mfa) ? "none" : mfa >= 100 ? "ok" : "warn",
      href: `${CONSOLE_ROOT}/security?tab=operators`,
    },
  ];
}

// ---------------------------------------------------------------- KPI composition

export interface MixPart {
  key: string;
  label: string;
  value: number;
  /** A colour token, e.g. "var(--chart-cat-1)". */
  color: string;
}

/** Colour follows the plan, never its rank; a custom plan joins "Other plans". */
const PLAN_COLOR: Record<string, string> = {
  STARTER: "var(--console-lavender-pale)",
  GROWTH: "var(--console-lavender-mark)",
  PRO: "var(--console-lime-mark)",
  ENTERPRISE: "var(--console-lavender-ink)",
};

export interface SubscriptionRow {
  plan_id: string;
  plan_name: string | null;
  mrr_bdt: number;
}

export function mrrByPlan(rows: readonly SubscriptionRow[]): MixPart[] {
  const parts = new Map<string, MixPart>();
  for (const [key, color] of Object.entries(PLAN_COLOR)) parts.set(key, { key, label: humanize(key), value: 0, color });
  parts.set("OTHER", { key: "OTHER", label: "Other plans", value: 0, color: "var(--color-track-strong)" });
  for (const row of rows) {
    const part = parts.get(row.plan_id in PLAN_COLOR ? row.plan_id : "OTHER");
    if (!part) continue;
    part.value += row.mrr_bdt;
    if (row.plan_name && part.key !== "OTHER") part.label = row.plan_name;
  }
  return [...parts.values()].filter((p) => p.value > 0);
}

export function tenantMix(t: PlatformOverviewMetrics["tenants"]): MixPart[] {
  const known = t.active + t.trial + t.suspended + t.archived;
  return [
    { key: "active", label: "active", value: t.active, color: "var(--color-success)" },
    { key: "trial", label: "trial", value: t.trial, color: "var(--color-info)" },
    { key: "suspended", label: "suspended", value: t.suspended, color: "var(--color-danger)" },
    { key: "archived", label: "archived", value: t.archived, color: "var(--color-text-muted)" },
    { key: "other", label: "other", value: Math.max(0, t.total - known), color: "var(--color-track-strong)" },
  ].filter((p) => p.value > 0);
}

// ---------------------------------------------------------------- charts

/** A round axis top at or above `max`, and its whole-number ticks from the first step up. */
export function axisTicks(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [1] };
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, max / 4)));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s * 4 >= max) ?? max;
  const count = Math.ceil(max / step);
  return { top: step * count, ticks: Array.from({ length: count }, (_, i) => step * (i + 1)) };
}

/** "2026-11-23" becomes "23 Nov". */
export function weekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekStart;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(date);
}

/** 1843 becomes "1.8 s", 420 becomes "420 ms". */
export function formatLatency(ms: number | null | undefined): string {
  if (!isPresent(ms)) return NO_DATA;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
