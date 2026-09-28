import { KillSwitchActiveError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Autonomous Control Plane Service
 * Top-level coordinator: routes across domains, manages global policies,
 * autonomy budgets, objectives, learning, optimization, workflows, incidents.
 */

import { db } from "@/infrastructure/db";
import {
  PlatformHealth,
  HealthStatus,
  HealthDimension,
  DomainHealthRecord,
  UnifiedCommerceContext,
  AutonomousWorkflowRun,
  AUTONOMOUS_SAFETY_BOUNDARIES,
  AutonomousSafetyBoundary,
} from "@/types/autonomous";

export class AutonomousControlPlaneService {
  /**
   * Generate executive overview of the autonomous platform state.
   */
  getAutonomousOverview(tenantId: string): {
    system_mode: string;
    health: HealthStatus;
    active_objectives: number;
    active_strategies: number;
    pending_decisions: number;
    active_workflows: number;
    learning_candidates: number;
    ai_providers_healthy: number;
    total_cost_today_bdt: number;
    safety_status: "ALL_CLEAR" | "BOUNDARY_TRIGGERED";
  } {
    const objectives = db.data.business_objectives.filter(
      (o) => o.tenant_id === tenantId && o.status === "ACTIVE"
    );
    const strategies = db.data.strategies.filter(
      (s) => s.tenant_id === tenantId && s.status === "ACTIVE"
    );
    const decisions = db.data.global_decisions.filter(
      (d) => d.tenant_id === tenantId && d.status === "AWAITING_APPROVAL"
    );
    const workflows = db.data.autonomous_workflow_runs.filter(
      (w) => w.tenant_id === tenantId && !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status)
    );
    const candidates = db.data.learning_candidates.filter(
      (c) => c.tenant_id === tenantId && !["DEPLOYED", "REJECTED", "ROLLED_BACK"].includes(c.status)
    );
    const providers = db.data.ai_providers.filter((p) => p.status === "ACTIVE");
    const health = db.data.platform_health_records.find((h) => h.tenant_id === tenantId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const costs = db.data.platform_cost_records.filter(
      (c) => c.tenant_id === tenantId && new Date(c.period_start) >= todayStart
    );
    const totalCost = costs.reduce((sum, c) => sum + c.total_cost_bdt, 0);

    return {
      system_mode: health?.autonomous_mode || "COPILOT",
      health: health?.overall_status || "UNKNOWN",
      active_objectives: objectives.length,
      active_strategies: strategies.length,
      pending_decisions: decisions.length,
      active_workflows: workflows.length,
      learning_candidates: candidates.length,
      ai_providers_healthy: providers.length,
      total_cost_today_bdt: totalCost,
      safety_status: "ALL_CLEAR",
    };
  }

  private getOrCreateHealth(tenantId: string): PlatformHealth {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    let health = db.data.platform_health_records.find((h) => h.tenant_id === tenantId);
    if (!health) {
      health = {
        id: `ph_${tenantId}_${Date.now()}`,
        tenant_id: tenantId,
        overall_status: "HEALTHY",
        autonomous_mode: "SEMI_AUTONOMOUS",
        uptime_percent_24h: null, // not monitored (was a literal 99.9)
        dimensions: {} as Record<HealthDimension, DomainHealthRecord>,
        assessed_at: new Date().toISOString(),
      };
      db.data.platform_health_records.push(health);
    }
    return health;
  }

  /**
   * Get the current system mode for the tenant.
   */
  getSystemMode(tenantId: string): string {
    // Read-only: this used to create and store a health record just to answer (FX-21 rule: reads never write)
    return db.data.platform_health_records.find((h) => h.tenant_id === tenantId)?.autonomous_mode ?? "SEMI_AUTONOMOUS";
  }

  /**
   * Refuses autonomous execution while the emergency halt is on (FX-34 step 3). The halt used to be recorded but
   * nothing checked it before starting cycles, workflows or decisions.
   */
  assertNotHalted(tenantId: string): void {
    if (this.getSystemMode(tenantId) === "EMERGENCY_HALTED") {
      throw new KillSwitchActiveError("AUTONOMOUS", "Autonomy is paused for this workspace. Resume it first.");
    }
  }

  /**
   * Emergency: Pause all autonomy for a tenant.
   * Humans retain control at all times (§43).
   */
  pauseAutonomy(
    tenantId: string,
    scope: { level: "ALL" | "DOMAIN" | "AGENT" | "WORKFLOW"; target?: string },
    reason: string,
    pausedBy: string
  ): { success: boolean; paused_scope: string; reason: string } {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const health = this.getOrCreateHealth(tenantId);
    if (scope.level === "ALL") {
      health.autonomous_mode = "EMERGENCY_HALTED";
      health.assessed_at = new Date().toISOString();
    }
    // Pause active workflows in scope
    const workflows = db.data.autonomous_workflow_runs.filter((w) => {
      if (w.tenant_id !== tenantId) return false;
      if (["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status)) return false;
      if (scope.level === "DOMAIN" && scope.target) {
        return w.domains_involved.includes(scope.target);
      }
      if (scope.level === "AGENT" && scope.target) {
        return w.agents_involved.includes(scope.target as any);
      }
      if (scope.level === "WORKFLOW" && scope.target) {
        return w.id === scope.target;
      }
      return true; // ALL
    });
    for (const wf of workflows) {
      wf.status = "PAUSED";
    }
    return {
      success: true,
      paused_scope: scope.level === "ALL" ? "ALL_AUTONOMY" : `${scope.level}:${scope.target}`,
      reason,
    };
  }

  /**
   * Resume autonomy after pause.
   */
  resumeAutonomy(
    tenantId: string,
    scope: { level: "ALL" | "DOMAIN" | "AGENT" | "WORKFLOW"; target?: string },
    resumedBy: string
  ): { success: boolean; resumed_scope: string } {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const health = this.getOrCreateHealth(tenantId);
    if (scope.level === "ALL") {
      health.autonomous_mode = "SEMI_AUTONOMOUS";
      health.assessed_at = new Date().toISOString();
    }
    return {
      success: true,
      resumed_scope: scope.level === "ALL" ? "ALL_AUTONOMY" : `${scope.level}:${scope.target}`,
    };
  }

  /**
   * Kill switch — immediately halt all autonomous operations (§43).
   */
  killSwitch(tenantId: string, reason: string, activatedBy: string): { halted: boolean; reason: string } {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const health = this.getOrCreateHealth(tenantId);
    health.autonomous_mode = "EMERGENCY_HALTED";
    health.overall_status = "CRITICAL";
    health.assessed_at = new Date().toISOString();

    // Halt all active workflows
    db.data.autonomous_workflow_runs
      .filter((w) => w.tenant_id === tenantId && !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status))
      .forEach((w) => { w.status = "PAUSED"; });

    return { halted: true, reason };
  }

  /**
   * Validate that a proposed action does not violate safety boundaries (§44).
   */
  validateSafetyBoundary(
    proposedAction: string
  ): { allowed: boolean; violated_boundary?: AutonomousSafetyBoundary } {
    const violation = AUTONOMOUS_SAFETY_BOUNDARIES.find(
      (boundary) => proposedAction.toUpperCase().includes(boundary)
    );
    if (violation) {
      return { allowed: false, violated_boundary: violation };
    }
    return { allowed: true };
  }

  /**
   * Get active workflows by tenant.
   */
  getActiveWorkflows(tenantId: string): AutonomousWorkflowRun[] {
    return db.data.autonomous_workflow_runs.filter(
      (w) => w.tenant_id === tenantId && !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status)
    );
  }
}
