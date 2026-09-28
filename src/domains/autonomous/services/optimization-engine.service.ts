import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Optimization Engine Service
 * Multi-objective optimization with constraints, forecasts, historical performance, policies, budgets, risk.
 * Optimization must be explainable (§20). Must respect business constraints (§27).
 */

import { db } from "@/infrastructure/db";
import { BusinessObjective } from "@/types/autonomous";

export class OptimizationEngineService {
  /** Generate candidate strategies for an objective. */
  generateCandidateStrategies(tenantId: string, objectiveId: string): Array<{
    strategy_name: string;
    domains: string[];
    expected_impact: Record<string, number>;
    estimated_cost_bdt: number | null;
    risk_score: number | null;
    confidence: number | null;
    tradeoffs: string[];
  }> {
    const obj = db.data.business_objectives.find((o) => o.id === objectiveId && o.tenant_id === tenantId);
    if (!obj) throw new AppError("NOT_FOUND", `Objective not found: ${objectiveId}`, 404);

    // Generate domain-specific strategies based on objective type
    const candidates = [];
    if (obj.allowed_domains.includes("PRICING")) {
      candidates.push({
        strategy_name: "Dynamic Pricing Optimization",
        domains: ["PRICING", "INVENTORY"],
        expected_impact: {}, // not estimated (FX-30: were literal percentages)
        estimated_cost_bdt: null,
        risk_score: null,
        confidence: null,
        tradeoffs: ["May reduce conversion rate short-term", "Requires inventory visibility"],
      });
    }
    if (obj.allowed_domains.includes("MARKETING") || obj.allowed_domains.includes("GROWTH")) {
      candidates.push({
        strategy_name: "Targeted Retention Campaign",
        domains: ["GROWTH", "MARKETING"],
        expected_impact: {}, // not estimated (FX-30: were literal percentages)
        estimated_cost_bdt: null,
        risk_score: null,
        confidence: null,
        tradeoffs: ["Campaign budget allocation", "Potential audience fatigue"],
      });
    }
    if (obj.allowed_domains.includes("INVENTORY") || obj.allowed_domains.includes("PROCUREMENT")) {
      candidates.push({
        strategy_name: "Predictive Stock Optimization",
        domains: ["INVENTORY", "PROCUREMENT"],
        expected_impact: {}, // not estimated (FX-30: were literal percentages)
        estimated_cost_bdt: null,
        risk_score: null,
        confidence: null,
        tradeoffs: ["Requires forecast accuracy >75%", "May increase short-term PO volume"],
      });
    }
    return candidates;
  }

  /** Evaluate expected outcomes across multiple objectives. */
  evaluateExpectedOutcomes(tenantId: string, strategies: string[]): {
    combined_revenue_impact_bdt: number | null;
    combined_cost_bdt: number | null;
    combined_risk_score: number | null;
    constraint_violations: string[];
  } {
    const objectives = db.data.business_objectives.filter((o) => o.tenant_id === tenantId && o.status === "ACTIVE");
    const violations: string[] = [];

    for (const obj of objectives) {
      for (const constraint of obj.constraints) {
        if (constraint.type === "BUDGET" && obj.budget_spent_bdt > constraint.value * 0.9) {
          violations.push(`${obj.name}: ${constraint.name} near limit`);
        }
      }
    }

    return {
      // Not estimated: these were literals (৳2,50,000 / ৳80,000 / 28) (FX-30)
      combined_revenue_impact_bdt: null,
      combined_cost_bdt: null,
      combined_risk_score: null,
      constraint_violations: violations,
    };
  }

  /** Rank strategies by multi-objective tradeoff analysis. */
  rankByTradeoffs(candidates: Array<{ strategy_name: string; risk_score: number; confidence: number; estimated_cost_bdt: number }>): Array<{
    strategy_name: string;
    rank: number;
    composite_score: number;
  }> {
    return candidates
      .map((c) => ({
        strategy_name: c.strategy_name,
        rank: 0,
        composite_score: (c.confidence * 100) - (c.risk_score * 0.5) - (c.estimated_cost_bdt / 10000),
      }))
      .sort((a, b) => b.composite_score - a.composite_score)
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }

  /** Recommend optimizations based on current performance gaps. */
  recommendOptimizations(tenantId: string): Array<{
    domain: string;
    recommendation: string;
    /** Not estimated: this used to claim 30% of the remaining gap (FX-30). */
    expected_improvement: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH";
  }> {
    const recommendations = [];
    const objectives = db.data.business_objectives.filter((o) => o.tenant_id === tenantId && o.status === "ACTIVE");

    for (const obj of objectives) {
      if (obj.progress_percent < 40 && obj.forecast_achievement_percent !== null && obj.forecast_achievement_percent < 70) {
        recommendations.push({
          domain: obj.allowed_domains[0] || "GENERAL",
          recommendation: `Accelerate ${obj.name} — progress at ${obj.progress_percent}% with ${obj.forecast_achievement_percent}% forecast`,
          expected_improvement: null,
          priority: "HIGH" as const,
        });
      }
    }

    return recommendations;
  }
}
