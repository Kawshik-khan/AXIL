import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Global Decision Engine Service
 * Multi-objective decision making with context, options, constraints,
 * simulation, risk assessment, policy evaluation, and outcome verification.
 */

import { db } from "@/infrastructure/db";
import {
  GlobalDecision,
  DecisionStatus,
  DecisionOption,
  DecisionSimulation,
  DecisionRisk,
  DecisionPolicyResult,
  DecisionOutcomeRecord,
  DecisionCategory,
} from "@/types/autonomous";
import { AutonomyLevel } from "@/types/orchestration";

export class GlobalDecisionEngineService {
  /**
   * Create a new global decision requiring evaluation.
   */
  createDecision(decision: GlobalDecision): GlobalDecision {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    decision.status = "PENDING";
    decision.created_at = new Date().toISOString();
    decision.updated_at = decision.created_at;
    db.data.global_decisions.push(decision);
    return decision;
  }

  /**
   * Get decisions for a tenant, optionally filtered by status.
   */
  getDecisions(tenantId: string, status?: DecisionStatus): GlobalDecision[] {
    let results = db.data.global_decisions.filter((d) => d.tenant_id === tenantId);
    if (status) results = results.filter((d) => d.status === status);
    return results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  /**
   * Find a decision by ID.
   */
  findById(tenantId: string, decisionId: string): GlobalDecision | undefined {
    return db.data.global_decisions.find(
      (d) => d.id === decisionId && d.tenant_id === tenantId
    );
  }

  /**
   * Evaluate decision options and rank them by expected outcome.
   */
  evaluateOptions(tenantId: string, decisionId: string): {
    ranked_options: Array<{ option_id: string; name: string; score: number; recommendation: string }>;
  } {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);

    decision.status = "EVALUATING";
    decision.updated_at = new Date().toISOString();

    const ranked = decision.options
      .map((opt) => ({
        option_id: opt.id,
        name: opt.name,
        score: (opt.confidence * 100) - (opt.risk_score * 0.5) + ((opt.estimated_revenue_impact_bdt ?? 0) > 0 ? 20 : 0),
        recommendation: opt.confidence > 0.8 && opt.risk_score < 30 ? "RECOMMENDED" : "REVIEW_REQUIRED",
      }))
      .sort((a, b) => b.score - a.score);

    return { ranked_options: ranked };
  }

  /**
   * Simulate a decision option. Simulation NEVER modifies production (§12).
   */
  simulateDecision(tenantId: string, decisionId: string, optionId: string): DecisionSimulation {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);

    const option = decision.options.find((o) => o.id === optionId);
    if (!option) throw new AppError("NOT_FOUND", `Option not found: ${optionId}`, 404);

    decision.status = "SIMULATING";
    decision.updated_at = new Date().toISOString();

    const simulation: DecisionSimulation = {
      simulation_id: `sim_${decisionId}_${optionId}_${Date.now()}`,
      option_id: optionId,
      scenarios_evaluated: 0, // no scenario model exists (was a literal 100) (FX-30)
      expected_revenue_bdt: option.estimated_revenue_impact_bdt,
      expected_cost_bdt: option.estimated_cost_bdt,
      expected_margin_percent:
        option.estimated_revenue_impact_bdt && option.estimated_revenue_impact_bdt > 0
          ? ((option.estimated_revenue_impact_bdt - option.estimated_cost_bdt) / option.estimated_revenue_impact_bdt) * 100
          : null,
      risk_score: option.risk_score,
      confidence: option.confidence,
      side_effects: option.cons,
      simulated_at: new Date().toISOString(),
    };

    decision.simulation_results = simulation;
    return simulation;
  }

  /**
   * Apply policy checks to a decision.
   */
  applyPolicy(tenantId: string, decisionId: string): DecisionPolicyResult {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);

    const violations: string[] = [];
    const policiesEvaluated = ["BUDGET_POLICY", "RISK_POLICY", "AUTONOMY_POLICY", "APPROVAL_POLICY"];

    // Check if risk level requires approval
    const requiresEscalation = decision.risk_level === "HIGH" || decision.risk_level === "CRITICAL";

    // Check budget constraints
    const selectedOption = decision.options.find((o) => o.id === decision.selected_option_id);
    if (selectedOption && selectedOption.estimated_cost_bdt > 100000) {
      violations.push("Cost exceeds autonomous budget threshold");
    }

    const result: DecisionPolicyResult = {
      allowed: violations.length === 0 && !requiresEscalation,
      policies_evaluated: policiesEvaluated,
      policy_violations: violations,
      requires_escalation: requiresEscalation,
      escalation_reason: requiresEscalation ? `Risk level ${decision.risk_level} requires human approval` : undefined,
      autonomy_level_required: requiresEscalation ? "LEVEL_4_HIGH" as AutonomyLevel : "LEVEL_2_ASSISTED" as AutonomyLevel,
    };

    decision.policy_evaluation = result;
    if (result.allowed && !result.requires_escalation) {
      decision.status = "APPROVED";
    } else {
      decision.status = "AWAITING_APPROVAL";
    }
    decision.updated_at = new Date().toISOString();

    return result;
  }

  /**
   * Approve a pending decision.
   */
  approveDecision(tenantId: string, decisionId: string, approvedBy: string): GlobalDecision {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);
    if (decision.status !== "AWAITING_APPROVAL" && decision.status !== "SIMULATING" && decision.status !== "PENDING") {
      throw new Error(`Decision ${decisionId} is not awaiting approval (status: ${decision.status})`);
    }

    decision.status = "APPROVED";
    decision.approved_by = approvedBy;
    decision.approved_at = new Date().toISOString();
    decision.decided_at = decision.approved_at;
    decision.updated_at = decision.approved_at;
    return decision;
  }

  /**
   * Reject a pending decision.
   */
  rejectDecision(tenantId: string, decisionId: string, reason: string): GlobalDecision {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);

    decision.status = "REJECTED";
    decision.rejected_reason = reason;
    decision.decided_at = new Date().toISOString();
    decision.updated_at = decision.decided_at;
    return decision;
  }

  /**
   * Execute an approved decision.
   */
  executeDecision(tenantId: string, decisionId: string): GlobalDecision {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);
    if (decision.status !== "APPROVED") {
      throw new Error(`Decision ${decisionId} is not approved (status: ${decision.status})`);
    }

    decision.status = "EXECUTING";
    decision.executed_at = new Date().toISOString();
    decision.updated_at = decision.executed_at;
    return decision;
  }

  /**
   * Verify the outcome of an executed decision.
   */
  verifyOutcome(tenantId: string, decisionId: string, outcome: DecisionOutcomeRecord): GlobalDecision {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const decision = this.findById(tenantId, decisionId);
    if (!decision) throw new AppError("NOT_FOUND", `Decision not found: ${decisionId}`, 404);

    decision.outcome = outcome;
    decision.status = (outcome.success || (outcome as any).verified) ? "VERIFIED" : "FAILED";
    decision.verified_at = new Date().toISOString();
    decision.updated_at = decision.verified_at;
    return decision;
  }
}
