import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 6: Automation Safety & Governance Service
 * Implements infinite loop & recursion protection, multi-tier emergency kill switch,
 * and bulk execution safeguards.
 */

import { db } from "@/infrastructure/db";
import { RiskLevel } from "@/types/automation";

export interface KillSwitchState {
  globalPaused: boolean;
  pausedTenants: Set<string>;
  pausedProviders: Set<string>;
  pausedWorkflows: Set<string>;
  lastTrippedAt?: string;
  lastTrippedBy?: string;
  reason?: string;
}

export class AutomationSafetyService {
  private static readonly MAX_LINEAGE_DEPTH = 5;

  private static killSwitchState: KillSwitchState = {
    globalPaused: false,
    pausedTenants: new Set(),
    pausedProviders: new Set(),
    pausedWorkflows: new Set(),
  };

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
    if (this.killSwitchState.globalPaused) {
      return {
        isHalted: true,
        reason: `Global emergency kill switch is ACTIVE: ${this.killSwitchState.reason || "Platform emergency halt"}`,
      };
    }

    if (this.killSwitchState.pausedTenants.has(tenantId)) {
      return {
        isHalted: true,
        reason: `Automation kill switch active for tenant '${tenantId}'`,
      };
    }

    if (provider && this.killSwitchState.pausedProviders.has(provider.toUpperCase())) {
      return {
        isHalted: true,
        reason: `Kill switch active for provider '${provider}'`,
      };
    }

    if (workflowId && this.killSwitchState.pausedWorkflows.has(workflowId)) {
      return {
        isHalted: true,
        reason: `Kill switch active for workflow '${workflowId}'`,
      };
    }

    return { isHalted: false };
  }

  /**
   * Activates emergency kill switch
   */
  public static tripKillSwitch(
    scope: "GLOBAL" | "TENANT" | "PROVIDER" | "WORKFLOW",
    targetId: string | undefined,
    actorId: string,
    reason: string
  ): void {
    const now = new Date().toISOString();
    this.killSwitchState.lastTrippedAt = now;
    this.killSwitchState.lastTrippedBy = actorId;
    this.killSwitchState.reason = reason;

    if (scope === "GLOBAL") {
      this.killSwitchState.globalPaused = true;
    } else if (scope === "TENANT" && targetId) {
      this.killSwitchState.pausedTenants.add(targetId);
    } else if (scope === "PROVIDER" && targetId) {
      this.killSwitchState.pausedProviders.add(targetId.toUpperCase());
    } else if (scope === "WORKFLOW" && targetId) {
      this.killSwitchState.pausedWorkflows.add(targetId);
    }

    // Record audit log if tenant is defined
    const auditTenantId = scope === "TENANT" && targetId ? targetId : "SYSTEM";
    db.createAutomationAuditLog({
      id: `aud_ks_${Date.now()}_${randomSuffix()}`,
      tenant_id: auditTenantId,
      actor_id: actorId,
      action: "KILL_SWITCH_ACTIVATED",
      resource_type: "kill_switch",
      resource_id: targetId || "GLOBAL",
      metadata: { scope, reason },
      timestamp: now,
    });
  }

  /**
   * Resumes operations by clearing kill switch
   */
  public static resumeKillSwitch(
    scope: "GLOBAL" | "TENANT" | "PROVIDER" | "WORKFLOW",
    targetId: string | undefined,
    actorId: string
  ): void {
    const now = new Date().toISOString();

    if (scope === "GLOBAL") {
      this.killSwitchState.globalPaused = false;
      this.killSwitchState.reason = undefined;
    } else if (scope === "TENANT" && targetId) {
      this.killSwitchState.pausedTenants.delete(targetId);
    } else if (scope === "PROVIDER" && targetId) {
      this.killSwitchState.pausedProviders.delete(targetId.toUpperCase());
    } else if (scope === "WORKFLOW" && targetId) {
      this.killSwitchState.pausedWorkflows.delete(targetId);
    }

    const auditTenantId = scope === "TENANT" && targetId ? targetId : "SYSTEM";
    db.createAutomationAuditLog({
      id: `aud_ks_res_${Date.now()}_${randomSuffix()}`,
      tenant_id: auditTenantId,
      actor_id: actorId,
      action: "KILL_SWITCH_RESUMED",
      resource_type: "kill_switch",
      resource_id: targetId || "GLOBAL",
      metadata: { scope },
      timestamp: now,
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
    return {
      isGlobalPaused: this.killSwitchState.globalPaused,
      isTenantPaused: tenantId ? this.killSwitchState.pausedTenants.has(tenantId) : false,
      activePausedCount:
        (this.killSwitchState.globalPaused ? 1 : 0) +
        this.killSwitchState.pausedTenants.size +
        this.killSwitchState.pausedProviders.size +
        this.killSwitchState.pausedWorkflows.size,
      reason: this.killSwitchState.reason,
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
