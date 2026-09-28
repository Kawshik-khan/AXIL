import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Operational Budget & Emergency Kill Switch Service
 * Enforces strict financial, action volume, and AI spend quotas per tenant.
 */

import { db } from "@/infrastructure/db";
import { AutonomyBudget } from "@/types/operations";

export class OperationalBudgetService {
  /**
   * The tenant's operational budget as of today. Read-only (FX-21): a missing budget is returned as the default and a
   * new day's reset is applied to a copy. Callers that change the budget store it with upsertAutonomyBudget.
   */
  public getBudget(tenantId: string): AutonomyBudget {
    const stored = db.getAutonomyBudget(tenantId);
    const today = new Date().toISOString().split("T")[0];

    if (!stored) {
      return {
        id: `bud_${tenantId}`,
        tenant_id: tenantId,
        daily_max_actions: 250,
        daily_max_spend_bdt: 200000,
        daily_max_llm_cost_usd: 20.0,
        actions_used_today: 0,
        spend_used_today_bdt: 0,
        llm_cost_used_today_usd: 0,
        is_budget_exhausted: false,
        emergency_stopped: false,
        last_reset_date: today,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    if (stored.last_reset_date !== today) {
      // Automatic daily quota reset
      return {
        ...stored,
        actions_used_today: 0,
        spend_used_today_bdt: 0,
        llm_cost_used_today_usd: 0,
        is_budget_exhausted: false,
        last_reset_date: today,
        updated_at: new Date().toISOString(),
      };
    }
    return { ...stored };
  }

  public updateBudget(tenantId: string, updates: Partial<AutonomyBudget>): AutonomyBudget {
    const budget = this.getBudget(tenantId);
    Object.assign(budget, updates, { updated_at: new Date().toISOString() });
    return db.upsertAutonomyBudget(budget);
  }

  /**
   * Checks whether a planned action is permitted under the operational budget
   */
  public canExecute(
    tenantId: string,
    params: {
      actionCostBdt?: number;
      estimatedLlmCostUsd?: number;
    }
  ): { allowed: boolean; reason?: string } {
    const budget = this.getBudget(tenantId);

    if (budget.emergency_stopped) {
      return { allowed: false, reason: "Autonomous operations are emergency stopped by operator." };
    }

    if (budget.is_budget_exhausted) {
      return { allowed: false, reason: "Tenant operational budget is exhausted for today." };
    }

    if (budget.actions_used_today >= budget.daily_max_actions) {
      budget.is_budget_exhausted = true;
      db.upsertAutonomyBudget(budget);
      return { allowed: false, reason: `Daily action limit (${budget.daily_max_actions}) reached.` };
    }

    const nextSpend = budget.spend_used_today_bdt + (params.actionCostBdt || 0);
    if (nextSpend > budget.daily_max_spend_bdt) {
      return {
        allowed: false,
        reason: `Action spend (৳${params.actionCostBdt}) exceeds remaining daily budget (৳${budget.daily_max_spend_bdt - budget.spend_used_today_bdt}).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Records execution consumption against the budget
   */
  public recordUsage(
    tenantId: string,
    params: {
      actionsCount?: number;
      spendBdt?: number;
      llmCostUsd?: number;
    }
  ): AutonomyBudget {
    const budget = this.getBudget(tenantId);
    budget.actions_used_today += params.actionsCount || 1;
    budget.spend_used_today_bdt += params.spendBdt || 0;
    budget.llm_cost_used_today_usd += params.llmCostUsd || 0;

    if (
      budget.actions_used_today >= budget.daily_max_actions ||
      budget.spend_used_today_bdt >= budget.daily_max_spend_bdt ||
      budget.llm_cost_used_today_usd >= budget.daily_max_llm_cost_usd
    ) {
      budget.is_budget_exhausted = true;
    }

    budget.updated_at = new Date().toISOString();
    return db.upsertAutonomyBudget(budget);
  }

  /**
   * Emergency Kill Switch: immediately halts all autonomous execution
   */
  public triggerKillSwitch(tenantId: string, reason: string): AutonomyBudget {
    const budget = this.getBudget(tenantId);
    budget.emergency_stopped = true;
    budget.updated_at = new Date().toISOString();
    db.upsertAutonomyBudget(budget);

    db.createAuditLog({
      id: `aud_ops_killswitch_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: "OPERATOR",
      action: "OPERATIONAL_KILL_SWITCH_TRIGGERED",
      resource_type: "autonomy_budget",
      resource_id: budget.id,
      metadata: { reason },
      created_at: new Date().toISOString(),
    });

    return budget;
  }

  /**
   * Clears the Emergency Kill Switch
   */
  public clearKillSwitch(tenantId: string): AutonomyBudget {
    const budget = this.getBudget(tenantId);
    budget.emergency_stopped = false;
    budget.updated_at = new Date().toISOString();
    db.upsertAutonomyBudget(budget);

    db.createAuditLog({
      id: `aud_ops_killswitch_cleared_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: "OPERATOR",
      action: "OPERATIONAL_KILL_SWITCH_CLEARED",
      resource_type: "autonomy_budget",
      resource_id: budget.id,
      metadata: {},
      created_at: new Date().toISOString(),
    });

    return budget;
  }
}

export const operationalBudgetService = new OperationalBudgetService();
