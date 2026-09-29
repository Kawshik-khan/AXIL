import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Autonomy Adaptation Service
 * Controlled autonomy level adjustment with mandatory governance approval.
 * Autonomy cannot self-increase without governance (§18, §44).
 */

import { db } from "@/infrastructure/db";
import { AutonomyRecommendation, AutonomyRecommendationType } from "@/types/autonomous";
import { AutonomyLevel } from "@/types/orchestration";
import { randomSuffix } from "@/lib/ids";

export class AutonomyAdaptationService {
  getRecommendations(tenantId: string): AutonomyRecommendation[] {
    return db.data.autonomy_recommendations.filter((r) => r.tenant_id === tenantId);
  }

  /** Assess whether autonomy level should change based on performance evidence. */
  assessAutonomyLevel(tenantId: string, domain: string): AutonomyRecommendation {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const agentRuns = db.data.agent_runs?.filter((r) => r.tenant_id === tenantId) || [];
    const recent = agentRuns.filter((r) => Date.now() - new Date(r.created_at).getTime() < 30 * 86400000);
    const successRate = recent.length > 0
      ? recent.filter((r) => r.status === "COMPLETED").length / recent.length
      : 0;
    const failureRate = 1 - successRate;

    let recommendationType: AutonomyRecommendationType = "MAINTAIN_AUTONOMY";
    let recommendedLevel: AutonomyLevel = "LEVEL_2_ASSISTED";

    if (successRate > 0.95 && recent.length > 50) {
      recommendationType = "INCREASE_AUTONOMY";
      recommendedLevel = "LEVEL_3_CONDITIONAL";
    } else if (failureRate > 0.2) {
      recommendationType = "DECREASE_AUTONOMY";
      recommendedLevel = "LEVEL_1_COPILOT";
    }

    const recommendation: AutonomyRecommendation = {
      id: `arec_${domain}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      domain,
      recommendation_type: recommendationType,
      current_level: "LEVEL_2_ASSISTED",
      recommended_level: recommendedLevel,
      evidence: {
        success_rate: Math.round(successRate * 100) / 100,
        failure_rate: Math.round(failureRate * 100) / 100,
        financial_impact_bdt: 0,
        verification_pass_rate: null, // not measured (was a literal 0.94) (FX-30)
        human_override_rate: null, // not measured (was a literal 0.05)
        sample_size: recent.length,
        period_days: 30,
      },
      status: "PROPOSED",
      created_at: new Date().toISOString(),
    };

    db.data.autonomy_recommendations.push(recommendation);
    return recommendation;
  }

  /** Simulate the impact of changing autonomy level. */
  simulateAdaptation(tenantId: string, recommendationId: string): AutonomyRecommendation {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const rec = db.data.autonomy_recommendations.find(
      (r) => r.id === recommendationId && r.tenant_id === tenantId
    );
    if (!rec) throw new AppError("NOT_FOUND", `Recommendation not found: ${recommendationId}`, 404);
    rec.status = "SIMULATING";
    rec.simulation_result = {
      // No simulation model exists; the +15% throughput / -8% cost were literals (FX-30)
      expected_improvement: {},
      risk_score: null,
      confidence: null,
      note: "Not simulated: there's no model for autonomy changes yet. Decide from the evidence above.",
    };
    return rec;
  }

  /** Apply an approved autonomy adaptation. Cannot self-approve (§44). */
  applyAdaptation(tenantId: string, recommendationId: string, approvedBy: string): AutonomyRecommendation {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const rec = db.data.autonomy_recommendations.find(
      (r) => r.id === recommendationId && r.tenant_id === tenantId
    );
    if (!rec) throw new AppError("NOT_FOUND", `Recommendation not found: ${recommendationId}`, 404);
    if (rec.status !== "UNDER_REVIEW" && rec.status !== "SIMULATING") {
      throw new Error("Recommendation must be under review or simulated before approval");
    }
    rec.status = "APPLIED";
    rec.reviewed_by = approvedBy;
    rec.reviewed_at = new Date().toISOString();
    return rec;
  }
}
