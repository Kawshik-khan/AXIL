import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Business Objectives Service
 * CRUD for business objectives with hierarchy (Enterprise → BU → Brand → Store → Domain → Workflow → Agent Task).
 */

import { db } from "@/infrastructure/db";
import {
  BusinessObjective,
  ObjectiveRun,
  ObjectiveOutcome,
  ObjectiveHierarchyLevel,
  ObjectiveStatus,
} from "@/types/autonomous";

export class BusinessObjectivesService {
  /**
   * Get all objectives for a tenant, optionally filtered by status.
   */
  getObjectives(tenantId: string, status?: ObjectiveStatus): BusinessObjective[] {
    let results = db.data.business_objectives.filter((o) => o.tenant_id === tenantId);
    if (status) results = results.filter((o) => o.status === status);
    return results.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get a single objective by ID.
   */
  findById(tenantId: string, objectiveId: string): BusinessObjective | undefined {
    return db.data.business_objectives.find(
      (o) => o.id === objectiveId && o.tenant_id === tenantId
    );
  }

  /**
   * Create a new business objective with constraints and hierarchy position.
   */
  createObjective(objective: BusinessObjective): BusinessObjective {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    // Validate parent exists if specified
    if (objective.parent_objective_id) {
      const parent = db.data.business_objectives.find(
        (o) => o.id === objective.parent_objective_id && o.tenant_id === objective.tenant_id
      );
      if (!parent) throw new AppError("NOT_FOUND", `Parent objective not found: ${objective.parent_objective_id}`, 404);
    }
    db.data.business_objectives.push(objective);
    return objective;
  }

  /**
   * Update objective progress and status.
   */
  updateObjective(tenantId: string, objectiveId: string, updates: Partial<BusinessObjective>): BusinessObjective {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const idx = db.data.business_objectives.findIndex(
      (o) => o.id === objectiveId && o.tenant_id === tenantId
    );
    if (idx === -1) throw new AppError("NOT_FOUND", `Objective not found: ${objectiveId}`, 404);
    db.data.business_objectives[idx] = {
      ...db.data.business_objectives[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    return db.data.business_objectives[idx];
  }

  /**
   * Evaluate objective progress against targets.
   */
  evaluateProgress(tenantId: string, objectiveId: string): {
    objective_id: string;
    progress_percent: number;
    status: ObjectiveStatus;
    forecast_achievement_percent: number;
    at_risk_reasons: string[];
  } {
    const obj = this.findById(tenantId, objectiveId);
    if (!obj) throw new AppError("NOT_FOUND", `Objective not found: ${objectiveId}`, 404);

    const progress = obj.target_value !== 0
      ? Math.min(100, Math.abs((obj.current_value - obj.baseline_value) / (obj.target_value - obj.baseline_value)) * 100)
      : 0;

    const atRiskReasons: string[] = [];
    if (obj.budget_spent_bdt > obj.budget_allocated_bdt * 0.9) {
      atRiskReasons.push("Budget utilization above 90%");
    }
    if (progress < obj.forecast_achievement_percent * 0.5) {
      atRiskReasons.push("Progress significantly below forecast");
    }

    const newStatus: ObjectiveStatus = atRiskReasons.length > 0 ? "AT_RISK" : "ACTIVE";

    return {
      objective_id: objectiveId,
      progress_percent: Math.round(progress * 100) / 100,
      status: newStatus,
      forecast_achievement_percent: obj.forecast_achievement_percent,
      at_risk_reasons: atRiskReasons,
    };
  }

  /**
   * Get the full objective hierarchy for a tenant.
   */
  getObjectiveHierarchy(tenantId: string): Array<{
    objective: BusinessObjective;
    children: BusinessObjective[];
    depth: number;
  }> {
    const all = this.getObjectives(tenantId);
    const roots = all.filter((o) => !o.parent_objective_id);
    const result: Array<{ objective: BusinessObjective; children: BusinessObjective[]; depth: number }> = [];

    const traverse = (parent: BusinessObjective, depth: number) => {
      const children = all.filter((o) => o.parent_objective_id === parent.id);
      result.push({ objective: parent, children, depth });
      for (const child of children) {
        traverse(child, depth + 1);
      }
    };

    for (const root of roots) {
      traverse(root, 0);
    }
    return result;
  }

  /**
   * Assess risk for an objective based on constraints and progress.
   */
  assessRisk(tenantId: string, objectiveId: string): {
    risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    risks: Array<{ factor: string; severity: string; description: string }>;
  } {
    const obj = this.findById(tenantId, objectiveId);
    if (!obj) throw new AppError("NOT_FOUND", `Objective not found: ${objectiveId}`, 404);

    const risks: Array<{ factor: string; severity: string; description: string }> = [];

    // Budget risk
    const budgetUsage = obj.budget_allocated_bdt > 0
      ? obj.budget_spent_bdt / obj.budget_allocated_bdt
      : 0;
    if (budgetUsage > 0.95) {
      risks.push({ factor: "BUDGET", severity: "HIGH", description: "Budget nearly exhausted" });
    } else if (budgetUsage > 0.8) {
      risks.push({ factor: "BUDGET", severity: "MEDIUM", description: "Budget usage above 80%" });
    }

    // Time risk
    const now = new Date();
    const end = new Date(obj.time_horizon_end);
    const start = new Date(obj.time_horizon_start);
    const timeElapsed = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
    if (timeElapsed > 0.8 && obj.progress_percent < 60) {
      risks.push({ factor: "TIME", severity: "HIGH", description: "80% of time elapsed but under 60% progress" });
    }

    // Constraint violations
    for (const constraint of obj.constraints) {
      if (constraint.operator === "MIN" && obj.current_value < constraint.value) {
        risks.push({ factor: constraint.type, severity: "MEDIUM", description: `${constraint.name}: below minimum` });
      }
    }

    const riskLevel = risks.some((r) => r.severity === "HIGH") ? "HIGH"
      : risks.some((r) => r.severity === "MEDIUM") ? "MEDIUM"
      : risks.length > 0 ? "LOW" : "LOW";

    return { risk_level: riskLevel, risks };
  }

  /**
   * Record an objective run evaluation.
   */
  recordRun(run: ObjectiveRun): ObjectiveRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    db.data.objective_runs.push(run);
    return run;
  }

  /**
   * Record an objective outcome measurement.
   */
  recordOutcome(outcome: ObjectiveOutcome): ObjectiveOutcome {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    db.data.objective_outcomes.push(outcome);
    return outcome;
  }
}
