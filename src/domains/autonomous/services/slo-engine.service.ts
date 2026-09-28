import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: SLO Engine Service
 * Service Level Objectives with error budget tracking (§42).
 */

import { db } from "@/infrastructure/db";
import { SLODefinition, ErrorBudget } from "@/types/autonomous";

export class SLOEngineService {
  getSLOs(tenantId: string): SLODefinition[] {
    return db.data.slo_definitions.filter((s) => s.tenant_id === tenantId);
  }

  findById(tenantId: string, sloId: string): SLODefinition | undefined {
    return db.data.slo_definitions.find((s) => s.id === sloId && s.tenant_id === tenantId);
  }

  createSLO(slo: SLODefinition): SLODefinition {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    slo.created_at = new Date().toISOString();
    slo.updated_at = slo.created_at;
    db.data.slo_definitions.push(slo);
    return slo;
  }

  /** Evaluate SLO compliance. */
  evaluateSLOs(tenantId: string): Array<{ slo_id: string; name: string; status: string; current: number | null; target: number }> {
    return this.getSLOs(tenantId).map((slo) => ({
      slo_id: slo.id,
      name: slo.name,
      status: slo.status,
      current: slo.current_value,
      target: slo.target_value,
    }));
  }

  /** Calculate error budget for an SLO. */
  calculateErrorBudget(tenantId: string, sloId: string): ErrorBudget {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const slo = this.findById(tenantId, sloId);
    if (!slo) throw new AppError("NOT_FOUND", `SLO not found: ${sloId}`, 404);
    if (slo.error_budget_remaining_percent === null) {
      throw new AppError("NOT_MEASURED", `SLO ${sloId} has no measurements yet, so its error budget is unknown.`, 409);
    }

    const totalMinutes = 43200; // 30 days in minutes
    const budgetMinutes = totalMinutes * (slo.error_budget_percent / 100);
    const consumed = budgetMinutes * (1 - slo.error_budget_remaining_percent / slo.error_budget_percent);
    const remaining = slo.error_budget_remaining_percent / slo.error_budget_percent * 100;
    const burnRate = consumed / 30;

    const budget: ErrorBudget = {
      id: `eb_${sloId}_${Date.now()}`,
      slo_id: sloId,
      tenant_id: tenantId,
      total_budget_minutes: Math.round(budgetMinutes),
      consumed_minutes: Math.round(consumed),
      remaining_percent: Math.round(remaining * 100) / 100,
      burn_rate: Math.round(burnRate * 100) / 100,
      projected_exhaustion_date: burnRate > 0
        ? new Date(Date.now() + ((budgetMinutes - consumed) / burnRate) * 86400000).toISOString()
        : undefined,
      status: remaining > 50 ? "HEALTHY" : remaining > 20 ? "WARNING" : remaining > 0 ? "CRITICAL" : "EXHAUSTED",
      period_start: new Date(Date.now() - 30 * 86400000).toISOString(),
      period_end: new Date().toISOString(),
    };

    db.data.error_budgets.push(budget);
    return budget;
  }

  /** Get breached SLOs. */
  getBreachedSLOs(tenantId: string): SLODefinition[] {
    return this.getSLOs(tenantId).filter((s) => s.status === "BREACHED");
  }
}
