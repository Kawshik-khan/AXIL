import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Autonomous Workflows Service
 * Cross-domain autonomous workflow execution: Observe → Understand → Predict → Plan →
 * Simulate → Decide → Authorize → Execute → Verify → Learn → Optimize → Operate (§22).
 */

import { db } from "@/infrastructure/db";
import { AutonomousWorkflowRun, AutonomousWorkflowType } from "@/types/autonomous";
import { AgentType } from "@/types/ai";
import { randomSuffix } from "@/lib/ids";

export class AutonomousWorkflowsService {
  /** Start a cross-domain autonomous workflow. */
  startWorkflow(
    tenantId: string,
    workflowType: AutonomousWorkflowType,
    trigger: string,
    agentsInvolved: AgentType[],
    domainsInvolved: string[],
    objectiveId?: string,
    strategyId?: string
  ): AutonomousWorkflowRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run: AutonomousWorkflowRun = {
      id: `awf_${workflowType.toLowerCase()}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      workflow_type: workflowType,
      objective_id: objectiveId,
      strategy_id: strategyId,
      trigger,
      status: "OBSERVING",
      current_loop_step: "OBSERVE",
      agents_involved: agentsInvolved,
      domains_involved: domainsInvolved,
      decisions_made: [],
      actions_executed: [],
      checkpoints: [{ step: "OBSERVE", state: { trigger, started: true }, checkpointed_at: new Date().toISOString() }],
      started_at: new Date().toISOString(),
      correlation_id: `corr_${workflowType}_${Date.now()}`,
    };
    db.data.autonomous_workflow_runs.push(run);
    return run;
  }

  /** Get workflow run by ID. */
  findById(tenantId: string, runId: string): AutonomousWorkflowRun | undefined {
    return db.data.autonomous_workflow_runs.find((w) => w.id === runId && w.tenant_id === tenantId);
  }

  /** Transition workflow through the autonomous loop steps. */
  transitionStep(tenantId: string, runId: string, toStep: string, state?: Record<string, unknown>): AutonomousWorkflowRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run = this.findById(tenantId, runId);
    if (!run) throw new AppError("NOT_FOUND", `Workflow run not found: ${runId}`, 404);

    const stepMap: Record<string, AutonomousWorkflowRun["status"]> = {
      "OBSERVE": "OBSERVING",
      "UNDERSTAND": "UNDERSTANDING",
      "PREDICT": "PREDICTING",
      "PLAN": "PLANNING",
      "SIMULATE": "SIMULATING",
      "EVALUATE_RISK": "EVALUATING_RISK",
      "POLICY_CHECK": "POLICY_CHECK",
      "APPROVAL": "AWAITING_APPROVAL",
      "EXECUTE": "EXECUTING",
      "VERIFY": "VERIFYING",
      "MEASURE": "MEASURING",
      "LEARN": "LEARNING",
      "OPTIMIZE": "OPTIMIZING",
      "COMPLETE": "COMPLETED",
    };

    run.status = stepMap[toStep] || run.status;
    run.current_loop_step = toStep;
    run.checkpoints.push({ step: toStep, state: state || {}, checkpointed_at: new Date().toISOString() });

    if (toStep === "COMPLETE") {
      run.status = "COMPLETED";
      run.completed_at = new Date().toISOString();
    }

    return run;
  }

  /** Record a decision made during workflow execution. */
  recordDecision(tenantId: string, runId: string, decisionId: string): void {
    const run = this.findById(tenantId, runId);
    if (run) run.decisions_made.push(decisionId);
  }

  /** Record an action executed during workflow. */
  recordAction(tenantId: string, runId: string, action: string): void {
    const run = this.findById(tenantId, runId);
    if (run) run.actions_executed.push(action);
  }

  /** Fail a workflow with reason. */
  failWorkflow(tenantId: string, runId: string, reason: string): AutonomousWorkflowRun {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const run = this.findById(tenantId, runId);
    if (!run) throw new AppError("NOT_FOUND", `Workflow run not found: ${runId}`, 404);
    run.status = "FAILED";
    run.completed_at = new Date().toISOString();
    run.outcome = {
      success: false,
      metrics: {},
      learning_candidates: [],
      duration_ms: new Date(run.completed_at).getTime() - new Date(run.started_at).getTime(),
    };
    return run;
  }

  /** Get all active workflows for a tenant. */
  getActiveWorkflows(tenantId: string): AutonomousWorkflowRun[] {
    return db.data.autonomous_workflow_runs.filter(
      (w) => w.tenant_id === tenantId && !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status)
    );
  }

  /** Get workflow history. */
  getWorkflowHistory(tenantId: string, limit: number = 20): AutonomousWorkflowRun[] {
    return db.data.autonomous_workflow_runs
      .filter((w) => w.tenant_id === tenantId)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, limit);
  }
}
