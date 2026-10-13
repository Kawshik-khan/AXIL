/**
 * The Control Tower "Needs attention" inbox (super-admin console plan §A). Every item is computed on read from the
 * current platform state — nothing is stored (GET never writes) and nothing is estimated: each item names the
 * records it came from. Thresholds are registered settings (settings-registry.ts).
 */
import { db } from "@/infrastructure/db";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformEntitlementService } from "./platform-entitlement.service";
import { PlatformSettingsService } from "./platform-settings.service";

export type AttentionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface AttentionItem {
  /** Stable for the same underlying condition, so the console can key on it. */
  id: string;
  severity: AttentionSeverity;
  category: "INCIDENT" | "KILL_SWITCH" | "LIMIT" | "DEAD_LETTER" | "HITL" | "APPROVAL" | "SECURITY" | "SUPPORT";
  title: string;
  detail: string;
  count?: number;
  /** Console path that resolves the item. */
  href: string;
  /** When the condition started (the source record's time) or, for a computed aggregate, when it was computed. */
  observed_at: string;
}

const CONSOLE = "/super-admin";
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const INCIDENT_SEVERITY: Record<string, AttentionSeverity> = {
  SEV1: "CRITICAL",
  SEV2: "HIGH",
  SEV3: "MEDIUM",
  SEV4: "LOW",
};

export class PlatformAttentionService {
  public static async list(context: PlatformContext, now: number = Date.now()): Promise<AttentionItem[]> {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const nowIso = new Date(now).toISOString();
    const items: AttentionItem[] = [];

    // Open incidents
    for (const incident of db.getPlatformIncidents()) {
      if (incident.status === "RESOLVED" || incident.status === "CLOSED") continue;
      items.push({
        id: `incident:${incident.id}`,
        severity: INCIDENT_SEVERITY[incident.severity] ?? "MEDIUM",
        category: "INCIDENT",
        title: `${incident.severity} incident: ${incident.title}`,
        detail: `Status ${incident.status.toLowerCase()}${incident.affected_components.length ? ` · ${incident.affected_components.join(", ")}` : ""}`,
        href: `${CONSOLE}/safety?tab=incidents`,
        observed_at: incident.started_at,
      });
    }

    // Active kill switches
    for (const ks of db.getPlatformKillSwitches()) {
      if (!ks.is_active) continue;
      items.push({
        id: `kill_switch:${ks.id}`,
        severity: ks.scope === "GLOBAL" ? "CRITICAL" : "HIGH",
        category: "KILL_SWITCH",
        title: `${ks.scope} kill switch active${ks.target_id ? `: ${ks.target_id}` : ""}`,
        detail: ks.reason,
        href: `${CONSOLE}/safety`,
        observed_at: ks.activated_at ?? ks.updated_at,
      });
    }

    // Unresolved dead letters
    const deadLetters = (db.data.automation_dead_letters || []).filter((d) => d.status === "UNRESOLVED");
    if (deadLetters.length > 0) {
      const oldest = deadLetters.reduce((a, b) => (a.timestamp < b.timestamp ? a : b));
      const tenants = new Set(deadLetters.map((d) => d.tenant_id)).size;
      items.push({
        id: "dead_letters:unresolved",
        severity: "MEDIUM",
        category: "DEAD_LETTER",
        title: `${deadLetters.length} unresolved dead letter${deadLetters.length === 1 ? "" : "s"}`,
        detail: `Across ${tenants} tenant${tenants === 1 ? "" : "s"}; oldest failed ${oldest.timestamp}`,
        count: deadLetters.length,
        href: `${CONSOLE}/automations?tab=dlq`,
        observed_at: oldest.timestamp,
      });
    }

    // HITL escalations past their SLA
    const breached = (db.data.agent_hitl_escalations || []).filter(
      (e) => e.status === "PENDING_REVIEW" && Date.parse(e.sla_due_at) < now
    );
    if (breached.length > 0) {
      const oldest = breached.reduce((a, b) => (a.sla_due_at < b.sla_due_at ? a : b));
      items.push({
        id: "hitl:sla_breached",
        severity: "HIGH",
        category: "HITL",
        title: `${breached.length} human handover${breached.length === 1 ? "" : "s"} past SLA`,
        detail: "Waiting for a person to review; the AI is paused on these conversations",
        count: breached.length,
        href: `${CONSOLE}/ai?tab=hitl`,
        observed_at: oldest.sla_due_at,
      });
    }

    // Pending two-person approvals
    const pendingApprovals = (db.data.platform_approval_requests || []).filter(
      (a) => a.status === "PENDING" && Date.parse(a.expires_at) > now
    );
    if (pendingApprovals.length > 0) {
      const oldest = pendingApprovals.reduce((a, b) => (a.requested_at < b.requested_at ? a : b));
      items.push({
        id: "approvals:pending",
        severity: "HIGH",
        category: "APPROVAL",
        title: `${pendingApprovals.length} approval request${pendingApprovals.length === 1 ? "" : "s"} waiting`,
        detail: "A second operator must approve before these actions can run",
        count: pendingApprovals.length,
        href: `${CONSOLE}/security?tab=approvals`,
        observed_at: oldest.requested_at,
      });
    }

    // Active operators without MFA
    const noMfa = db.getPlatformMemberships().filter((m) => m.is_active && !m.mfa_enabled);
    if (noMfa.length > 0) {
      items.push({
        id: "operators:no_mfa",
        severity: "HIGH",
        category: "SECURITY",
        title: `${noMfa.length} active operator${noMfa.length === 1 ? "" : "s"} without MFA`,
        detail: "They can't complete step-up, so they can't run HIGH or CRITICAL actions",
        count: noMfa.length,
        href: `${CONSOLE}/security?tab=operators`,
        observed_at: nowIso,
      });
    }

    // Recent HIGH / CRITICAL security events
    const windowHours = PlatformSettingsService.getEffectiveSetting<number>("attention.security_event_window_hours");
    const since = now - windowHours * 60 * 60 * 1000;
    const events = db
      .getPlatformSecurityEvents(500)
      .filter((e) => (e.severity === "HIGH" || e.severity === "CRITICAL") && Date.parse(e.created_at) >= since);
    if (events.length > 0) {
      const latest = events.reduce((a, b) => (a.created_at > b.created_at ? a : b));
      items.push({
        id: "security_events:recent",
        severity: events.some((e) => e.severity === "CRITICAL") ? "CRITICAL" : "HIGH",
        category: "SECURITY",
        title: `${events.length} high-severity security event${events.length === 1 ? "" : "s"} in ${windowHours} h`,
        detail: `Latest: ${latest.description}`,
        count: events.length,
        href: `${CONSOLE}/audit`,
        observed_at: latest.created_at,
      });
    }

    // Active support sessions
    const sessions = db.getImpersonationSessions().filter((s) => !s.revoked_at && Date.parse(s.expires_at) > now);
    if (sessions.length > 0) {
      items.push({
        id: "support_sessions:active",
        severity: "LOW",
        category: "SUPPORT",
        title: `${sessions.length} support session${sessions.length === 1 ? "" : "s"} in progress`,
        detail: "Operators are viewing tenant workspaces read-only",
        count: sessions.length,
        href: `${CONSOLE}/security?tab=support`,
        observed_at: sessions.reduce((a, b) => (a.created_at < b.created_at ? a : b)).created_at,
      });
    }

    // Tenants at or above the limit warning threshold (enforced limits only)
    const thresholdPct = PlatformSettingsService.getEffectiveSetting<number>("attention.entitlement_threshold_pct");
    const liveTenants = db.getTenants().filter((t) => t.status === "ACTIVE" || t.status === "TRIAL");
    for (const tenant of liveTenants) {
      const report = await PlatformEntitlementService.buildReport(tenant.id, now);
      for (const ent of report.entitlements) {
        if (ent.usage_ratio === null || ent.usage_ratio * 100 < thresholdPct) continue;
        const atLimit = ent.usage_ratio >= 1;
        items.push({
          id: `limit:${tenant.id}:${ent.id}`,
          severity: atLimit ? "HIGH" : "MEDIUM",
          category: "LIMIT",
          title: `${tenant.name}: ${ent.label} ${ent.usage_ratio > 1 ? "over limit" : atLimit ? "at limit" : `at ${Math.floor(ent.usage_ratio * 100)}%`}`,
          detail: `${ent.usage} of ${ent.value}${ent.unit ? ` ${ent.unit}` : ""} · limit from ${ent.source.toLowerCase()}`,
          href: `${CONSOLE}/tenants/${encodeURIComponent(tenant.id)}?tab=usage`,
          observed_at: nowIso,
        });
      }
    }

    return items.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.observed_at.localeCompare(b.observed_at)
    );
  }
}
