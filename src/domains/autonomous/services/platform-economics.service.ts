/**
 * CommerceOS Phase 10: Platform Economics Service
 * Cost-aware autonomy tracking per entity (§40–§41).
 * Never sacrifice safety for cost reduction.
 */

import { db } from "@/infrastructure/db";
import { PlatformCostRecord } from "@/types/autonomous";

export class PlatformEconomicsService {
  /** Track a cost record for the period. */
  trackCost(record: PlatformCostRecord): PlatformCostRecord {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    record.computed_at = new Date().toISOString();
    db.data.platform_cost_records.push(record);
    return record;
  }

  /** Get cost breakdown for a tenant. */
  getCostBreakdown(tenantId: string, period?: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY"): PlatformCostRecord[] {
    let results = db.data.platform_cost_records.filter((c) => c.tenant_id === tenantId);
    if (period) results = results.filter((c) => c.period === period);
    return results.sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());
  }

  /** Calculate cost efficiency: business_value / automation_cost. */
  optimizeCostEfficiency(tenantId: string): {
    current_ratio: number;
    recommendations: Array<{ area: string; potential_savings_bdt: number; recommendation: string }>;
  } {
    const costs = this.getCostBreakdown(tenantId, "DAILY");
    const latestCost = costs[0];
    if (!latestCost) return { current_ratio: 0, recommendations: [] };

    const recommendations = [];
    if (latestCost.llm_cost_bdt > latestCost.total_cost_bdt * 0.6) {
      recommendations.push({
        area: "LLM_COST",
        potential_savings_bdt: latestCost.llm_cost_bdt * 0.2,
        recommendation: "Route low-complexity tasks to cheaper models",
      });
    }
    if (latestCost.cost_per_autonomous_decision_bdt > 50) {
      recommendations.push({
        area: "DECISION_COST",
        potential_savings_bdt: latestCost.cost_per_autonomous_decision_bdt * 0.15,
        recommendation: "Batch similar decisions to reduce per-decision overhead",
      });
    }
    return { current_ratio: latestCost.cost_efficiency_ratio, recommendations };
  }

  /** Get per-entity cost metrics. */
  getEntityCosts(tenantId: string): Record<string, number> {
    const latest = this.getCostBreakdown(tenantId, "DAILY")[0];
    if (!latest) return {};
    return {
      ...latest.breakdown_by_domain,
      ...latest.breakdown_by_agent,
    };
  }
}
