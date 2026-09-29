import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Autonomous Cycles Service
 * Daily, weekly, monthly autonomous cycles: Observe → Understand → Plan → Execute → Learn (§22).
 */

import { db } from "@/infrastructure/db";
import { AutonomousWorkflowRun } from "@/types/autonomous";
import { AutonomousControlPlaneService } from "./autonomous-control-plane.service";
import { randomSuffix } from "@/lib/ids";

// Stateless (reads the store); a local instance avoids importing the services index, which imports this module
const controlPlane = new AutonomousControlPlaneService();

export class AutonomousCyclesService {
  /** Start a daily autonomous cycle. */
  startDailyCycle(tenantId: string, trigger: "SCHEDULED" | "MANUAL" = "SCHEDULED"): AutonomousWorkflowRun {
    return this.startCycle(tenantId, "DAILY_CYCLE", trigger, [
      "MORNING_HEALTH_CHECK",
      "INVENTORY_REVIEW",
      "ORDER_PIPELINE_REVIEW",
      "EXCEPTION_TRIAGE",
      "PERFORMANCE_SNAPSHOT",
      "RECOMMENDATION_DIGEST",
      "EVENING_SUMMARY",
    ]);
  }

  /** Start a weekly autonomous cycle. */
  startWeeklyCycle(tenantId: string, trigger: "SCHEDULED" | "MANUAL" = "SCHEDULED"): AutonomousWorkflowRun {
    return this.startCycle(tenantId, "WEEKLY_CYCLE", trigger, [
      "WEEK_PERFORMANCE_ANALYSIS",
      "OBJECTIVE_PROGRESS_REVIEW",
      "STRATEGY_EFFECTIVENESS",
      "AGENT_PERFORMANCE_AUDIT",
      "COST_EFFICIENCY_REVIEW",
      "LEARNING_CANDIDATE_REVIEW",
      "NEXT_WEEK_PLANNING",
    ]);
  }

  /** Start a monthly autonomous cycle. */
  startMonthlyCycle(tenantId: string, trigger: "SCHEDULED" | "MANUAL" = "SCHEDULED"): AutonomousWorkflowRun {
    return this.startCycle(tenantId, "MONTHLY_CYCLE", trigger, [
      "MONTH_PERFORMANCE_REPORT",
      "OBJECTIVE_ACHIEVEMENT_ASSESSMENT",
      "STRATEGY_OUTCOME_REVIEW",
      "AUTONOMY_LEVEL_ASSESSMENT",
      "MODEL_PERFORMANCE_AUDIT",
      "COST_OPTIMIZATION_REVIEW",
      "SLO_COMPLIANCE_REPORT",
      "NEXT_MONTH_OBJECTIVE_PLANNING",
    ]);
  }

  /**
   * Records a cycle run at its first step. Nothing executes the steps yet: the run stays OBSERVING until an
   * autonomous worker exists, which callers must say rather than report the cycle as done.
   */
  private startCycle(
    tenantId: string,
    cycleType: "DAILY_CYCLE" | "WEEKLY_CYCLE" | "MONTHLY_CYCLE",
    trigger: "SCHEDULED" | "MANUAL",
    steps: string[]
  ): AutonomousWorkflowRun {
    controlPlane.assertNotHalted(tenantId); // the emergency halt applies (FX-34)
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run: AutonomousWorkflowRun = {
      id: `awf_${cycleType.toLowerCase()}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      workflow_type: cycleType,
      trigger,
      status: "OBSERVING",
      current_loop_step: steps[0],
      agents_involved: ["AUTONOMOUS_SUPERVISOR", "PLATFORM_HEALTH_AGENT", "COST_GOVERNANCE_AGENT"],
      domains_involved: ["COMMERCE", "INTELLIGENCE", "GROWTH", "OPERATIONS", "ENTERPRISE"],
      decisions_made: [],
      actions_executed: [],
      checkpoints: [{ step: steps[0], state: { started: true }, checkpointed_at: new Date().toISOString() }],
      started_at: new Date().toISOString(),
      correlation_id: `corr_${cycleType}_${Date.now()}`,
    };
    db.data.autonomous_workflow_runs.push(run);
    return run;
  }

  /** Advance a workflow run to the next step. */
  advanceStep(tenantId: string, runId: string, nextStep: string): AutonomousWorkflowRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run = db.data.autonomous_workflow_runs.find(
      (w) => w.id === runId && w.tenant_id === tenantId
    );
    if (!run) throw new AppError("NOT_FOUND", `Workflow run not found: ${runId}`, 404);
    run.current_loop_step = nextStep;
    run.checkpoints.push({ step: nextStep, state: { advanced: true }, checkpointed_at: new Date().toISOString() });
    return run;
  }

  /** Complete a workflow run with outcome metrics. */
  completeRun(tenantId: string, runId: string, metrics: Record<string, { before: number; after: number }>): AutonomousWorkflowRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run = db.data.autonomous_workflow_runs.find(
      (w) => w.id === runId && w.tenant_id === tenantId
    );
    if (!run) throw new AppError("NOT_FOUND", `Workflow run not found: ${runId}`, 404);
    run.status = "COMPLETED";
    run.completed_at = new Date().toISOString();
    run.outcome = {
      success: true,
      metrics,
      learning_candidates: [],
      duration_ms: new Date(run.completed_at).getTime() - new Date(run.started_at).getTime(),
    };
    return run;
  }

  /** Get workflow runs by type. */
  getRunsByType(tenantId: string, type: string): AutonomousWorkflowRun[] {
    return db.data.autonomous_workflow_runs.filter(
      (w) => w.tenant_id === tenantId && w.workflow_type === type
    );
  }
}
