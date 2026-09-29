import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 6: Automation Safety & Governance Service
 * Implements infinite loop & recursion protection, multi-tier emergency kill switch,
 * and bulk execution safeguards.
 */

import { db } from "@/infrastructure/db";
import { RiskLevel } from "@/types/automation";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";

export class AutomationSafetyService {
  private static readonly MAX_LINEAGE_DEPTH = 5;

  /**
   * Evaluates if event lineage poses an infinite recursion loop hazard
   */
  public static checkLoopProtection(
    currentEventId: string,
    causationId?: string,
    ancestorEventIds: string[] = []
  ): { isSafe: boolean; depth: number; reason?: string } {
    if (!causationId) {
      return { isSafe: true, depth: 1 };
    }

    const depth = ancestorEventIds.length + 1;
    if (depth > this.MAX_LINEAGE_DEPTH) {
      return {
        isSafe: false,
        depth,
        reason: `Event lineage depth of ${depth} exceeds maximum threshold of ${this.MAX_LINEAGE_DEPTH}. Infinite loop suppression triggered.`,
      };
    }

    if (ancestorEventIds.includes(currentEventId) || ancestorEventIds.includes(causationId)) {
      return {
        isSafe: false,
        depth,
        reason: `Cyclic causality detected between event '${currentEventId}' and ancestor '${causationId}'. Execution suppressed.`,
      };
    }

    return { isSafe: true, depth };
  }

  /**
   * Checks if an execution is halted by an active kill switch
   */
  public static isHaltedByKillSwitch(
    tenantId: string,
    workflowId?: string,
    provider?: string
  ): { isHalted: boolean; reason?: string } {
    // Stored, so a switch set on any app server (or before a restart) holds here too (ADR-109)
    const active = db.getActiveAutomationKillSwitches(tenantId, workflowId, provider);
    const global = active.find((k) => k.scope === "GLOBAL");
    if (global) {
      return { isHalted: true, reason: `Global emergency kill switch is ACTIVE: ${global.reason || "Platform emergency halt"}` };
    }
    const scoped = active[0];
    if (scoped) {
      const what = scoped.scope === "TENANT" ? "this workspace" : scoped.scope === "WORKFLOW" ? `workflow '${workflowId}'` : `provider '${provider}'`;
      return { isHalted: true, reason: `Automation kill switch active for ${what}` };
    }

    // Platform kill switches (operator console) apply too: they used to be recorded but never checked (FX-34, H11)
    if (
      PlatformSafetyService.isExecutionBlocked("TENANT", tenantId) ||
      (workflowId && PlatformSafetyService.isExecutionBlocked("WORKFLOW", workflowId)) ||
      (provider && PlatformSafetyService.isExecutionBlocked("PROVIDER", provider))
    ) {
      return { isHalted: true, reason: "A platform kill switch is active for this workspace, workflow or provider." };
    }

    return { isHalted: false };
  }

  /**
   * Activates an emergency kill switch. GLOBAL and PROVIDER switches stop every workspace: only callers acting for the
   * platform may set them (the tenant route allows its own workspace and its own workflows only).
   */
  public static tripKillSwitch(
    scope: "GLOBAL" | "TENANT" | "PROVIDER" | "WORKFLOW",
    targetId: string | undefined,
    actorId: string,
    reason: string,
    tenantId: string | null = scope === "TENANT" ? targetId ?? null : null
  ): void {
    const record = db.setAutomationKillSwitch({ scope, target_id: targetId ?? null, tenant_id: tenantId, active: true, reason, changed_by: actorId });
    db.createAutomationAuditLog({
      id: `aud_ks_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId ?? "SYSTEM",
      actor_id: actorId,
      action: "KILL_SWITCH_ACTIVATED",
      resource_type: "kill_switch",
      resource_id: record.target_id || "GLOBAL",
      metadata: { scope, reason },
      timestamp: record.updated_at,
    });
  }

  /**
   * Resumes operations by clearing a kill switch
   */
  public static resumeKillSwitch(
    scope: "GLOBAL" | "TENANT" | "PROVIDER" | "WORKFLOW",
    targetId: string | undefined,
    actorId: string,
    tenantId: string | null = scope === "TENANT" ? targetId ?? null : null
  ): void {
    const record = db.setAutomationKillSwitch({ scope, target_id: targetId ?? null, tenant_id: tenantId, active: false, changed_by: actorId });
    db.createAutomationAuditLog({
      id: `aud_ks_res_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId ?? "SYSTEM",
      actor_id: actorId,
      action: "KILL_SWITCH_RESUMED",
      resource_type: "kill_switch",
      resource_id: record.target_id || "GLOBAL",
      metadata: { scope },
      timestamp: record.updated_at,
    });
  }

  /**
   * Returns current kill switch status for telemetry and UI
   */
  public static getKillSwitchStatus(tenantId?: string): {
    isGlobalPaused: boolean;
    isTenantPaused: boolean;
    activePausedCount: number;
    reason?: string;
  } {
    const active = tenantId ? db.getActiveAutomationKillSwitches(tenantId) : [];
    const global = active.find((k) => k.scope === "GLOBAL");
    const tenant = active.find((k) => k.scope === "TENANT");
    return {
      isGlobalPaused: !!global,
      isTenantPaused: !!tenant,
      activePausedCount: db.countActiveAutomationKillSwitches(),
      reason: (global ?? tenant)?.reason,
    };
  }

  /**
   * Bulk Safeguard: enforces batch size limits and risk level approvals
   */
  public static validateBulkOperation(
    riskLevel: RiskLevel,
    itemCount: number,
    isApproved: boolean,
    isDryRun: boolean
  ): { allowed: boolean; reason?: string } {
    if (isDryRun) {
      return { allowed: true };
    }

    // High & Critical operations require explicit approval
    if ((riskLevel === "HIGH" || riskLevel === "CRITICAL") && !isApproved) {
      return {
        allowed: false,
        reason: `Operations with risk level '${riskLevel}' require explicit policy approval before execution.`,
      };
    }

    // Bounded batch limits
    const MAX_BULK_BATCH_SIZE = 100;
    if (itemCount > MAX_BULK_BATCH_SIZE) {
      return {
        allowed: false,
        reason: `Batch size of ${itemCount} exceeds maximum limit of ${MAX_BULK_BATCH_SIZE}. Split into smaller batches.`,
      };
    }

    return { allowed: true };
  }
}
