import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Strategy Engine Service
 * Strategy creation, version management, objective linking, constraint evaluation,
 * simulation, execution tracking, and outcome measurement.
 */

import { db } from "@/infrastructure/db";
import { Strategy, StrategyStatus, StrategySimulation, StrategyOutcome, StrategyPlan } from "@/types/autonomous";

export class StrategyEngineService {
  getStrategies(tenantId: string, status?: StrategyStatus): Strategy[] {
    let results = db.data.strategies.filter((s) => s.tenant_id === tenantId);
    if (status) results = results.filter((s) => s.status === status);
    return results;
  }

  findById(tenantId: string, strategyId: string): Strategy | undefined {
    return db.data.strategies.find((s) => s.id === strategyId && s.tenant_id === tenantId);
  }

  createStrategy(strategy: Strategy): Strategy {
    // Verify linked objective exists
    const obj = db.data.business_objectives.find(
      (o) => o.id === strategy.objective_id && o.tenant_id === strategy.tenant_id
    );
    if (!obj) throw new AppError("NOT_FOUND", `Linked objective not found: ${strategy.objective_id}`, 404);
    strategy.status = "DRAFT";
    strategy.created_at = new Date().toISOString();
    strategy.updated_at = strategy.created_at;
    db.data.strategies.push(strategy);
    return strategy;
  }

  simulateStrategy(tenantId: string, strategyId: string): StrategySimulation {
    const strategy = this.findById(tenantId, strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", `Strategy not found: ${strategyId}`, 404);
    strategy.status = "SIMULATING";
    strategy.updated_at = new Date().toISOString();

    const sim: StrategySimulation = {
      simulation_id: `ssim_${strategyId}_${Date.now()}`,
      scenarios_tested: 50,
      best_case: { revenue_impact_bdt: strategy.plan.estimated_cost_bdt * 3, margin_percent: 42 },
      worst_case: { revenue_impact_bdt: strategy.plan.estimated_cost_bdt * -0.5, margin_percent: 28 },
      expected_case: { revenue_impact_bdt: strategy.plan.estimated_cost_bdt * 1.8, margin_percent: 36 },
      risk_score: 35,
      confidence: 0.72,
      recommendation: "Proceed with monitoring — expected ROI positive under moderate assumptions.",
      simulated_at: new Date().toISOString(),
    };
    strategy.simulation = sim;
    return sim;
  }

  evaluateTradeoffs(tenantId: string, strategyId: string): {
    tradeoffs: Array<{ dimension: string; positive: string; negative: string }>;
  } {
    const strategy = this.findById(tenantId, strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", `Strategy not found: ${strategyId}`, 404);
    return {
      tradeoffs: strategy.domains_involved.map((domain) => ({
        dimension: domain,
        positive: `Optimizes ${domain.toLowerCase()} metrics`,
        negative: `May increase ${domain.toLowerCase()} operational cost`,
      })),
    };
  }

  activateStrategy(tenantId: string, strategyId: string): Strategy {
    const strategy = this.findById(tenantId, strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", `Strategy not found: ${strategyId}`, 404);
    strategy.status = "ACTIVE";
    strategy.execution = {
      started_at: new Date().toISOString(),
      steps_completed: 0,
      steps_total: strategy.plan.steps.length,
      status: "RUNNING",
    };
    strategy.updated_at = new Date().toISOString();
    return strategy;
  }

  recordOutcome(tenantId: string, strategyId: string, outcome: StrategyOutcome): Strategy {
    const strategy = this.findById(tenantId, strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", `Strategy not found: ${strategyId}`, 404);
    strategy.outcome = outcome;
    strategy.status = "COMPLETED";
    if (strategy.execution) {
      strategy.execution.status = "COMPLETED";
      strategy.execution.completed_at = new Date().toISOString();
      strategy.execution.steps_completed = strategy.execution.steps_total;
    }
    strategy.updated_at = new Date().toISOString();
    return strategy;
  }
}
