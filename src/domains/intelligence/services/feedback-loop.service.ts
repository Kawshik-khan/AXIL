/**
 * CommerceOS Phase 6: Decision Feedback Loop & Outcome Verification Service
 * Measures expected vs actual commercial results to evaluate decision efficacy and continuous learning.
 */

import { db } from "@/infrastructure/db";
import { DecisionOutcome } from "@/types/intelligence";
import { randomSuffix } from "@/lib/ids";

export interface RecordOutcomeParams {
  tenantId: string;
  decisionId: string;
  recommendationId?: string;
  workflowId?: string;
  evaluationHorizonDays: number;
  expectedMetrics: Record<string, number>;
  actualMetrics: Record<string, number>;
  learningNotes?: string;
}

export class DecisionFeedbackLoopService {
  /**
   * Records and evaluates the post-execution outcome of an approved decision
   */
  public recordDecisionOutcome(params: RecordOutcomeParams): DecisionOutcome {
    const { tenantId, decisionId, expectedMetrics, actualMetrics } = params;

    const variance: Record<string, { expected: number; actual: number; delta_pct: number }> = {};
    let totalPctDelta = 0;
    let metricsCount = 0;

    for (const [key, expectedVal] of Object.entries(expectedMetrics)) {
      const actualVal = actualMetrics[key] !== undefined ? actualMetrics[key] : expectedVal;
      const deltaPct = expectedVal !== 0 ? ((actualVal - expectedVal) / Math.abs(expectedVal)) * 100 : 0;

      variance[key] = {
        expected: expectedVal,
        actual: actualVal,
        delta_pct: Number(deltaPct.toFixed(1)),
      };

      totalPctDelta += deltaPct;
      metricsCount += 1;
    }

    const avgDelta = metricsCount > 0 ? totalPctDelta / metricsCount : 0;

    let evaluation: "EXCEEDED" | "MET" | "UNDERPERFORMED" | "INCONCLUSIVE" = "MET";
    if (avgDelta >= 10.0) evaluation = "EXCEEDED";
    else if (avgDelta < -15.0) evaluation = "UNDERPERFORMED";

    const outcome: DecisionOutcome = {
      id: `out_${Date.now()}_${tenantId}_${randomSuffix()}`,
      tenant_id: tenantId,
      decision_id: decisionId,
      recommendation_id: params.recommendationId,
      workflow_id: params.workflowId,
      observed_at: new Date().toISOString(),
      evaluation_horizon_days: params.evaluationHorizonDays,
      expected_metrics: expectedMetrics,
      actual_metrics: actualMetrics,
      variance,
      outcome_evaluation: evaluation,
      learning_notes: params.learningNotes || `Decision evaluated after ${params.evaluationHorizonDays} days. Average outcome variance: ${avgDelta.toFixed(1)}%.`,
      created_at: new Date().toISOString(),
    };

    db.insertDecisionOutcome(outcome);
    return outcome;
  }

  /**
   * Retrieves all decision outcomes for a tenant
   */
  public getOutcomes(tenantId: string): DecisionOutcome[] {
    return db.getDecisionOutcomes(tenantId);
  }
}

export const decisionFeedbackLoopService = new DecisionFeedbackLoopService();
export const feedbackLoopService = decisionFeedbackLoopService;
