import { newId, randomSuffix } from "@/lib/ids";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { businessObjectivesService } from "@/domains/autonomous/services";
import { ObjectiveStatus } from "@/types/autonomous";
import { ValidationError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OBJECTIVES_READ);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as ObjectiveStatus | null;
    const objectives = businessObjectivesService.getObjectives(context.tenant.id, status || undefined);
    return apiSuccess({ total: objectives.length, objectives });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OBJECTIVES_MANAGE);
    const body = await request.json();
    const now = new Date().toISOString();
    // An objective's numbers are the merchant's, never invented defaults (FX-30: were 10,00,000 / 5,00,000 / 50,000 / 60%)
    const name = body.name || body.title;
    const target = Number(body.target_value);
    const baseline = Number(body.baseline_value ?? body.current_value);
    if (!name || !Number.isFinite(target) || !Number.isFinite(baseline)) {
      throw new ValidationError("name, target_value and baseline_value (or current_value) are required.");
    }

    const created = businessObjectivesService.createObjective({
      id: newId("obj"), // never a client-chosen id (it could overwrite or collide with another record)
      tenant_id: context.tenant.id,
      organization_id: body.organization_id,
      parent_objective_id: body.parent_objective_id,
      hierarchy_level: body.hierarchy_level || "ENTERPRISE",
      scope_entity_id: body.scope_entity_id,
      name,
      description: body.description,
      status: body.status || "ACTIVE",
      target_metric: body.target_metric || "REVENUE_BDT",
      target_value: target,
      current_value: Number(body.current_value ?? baseline),
      baseline_value: baseline,
      unit: body.unit || "BDT",
      time_horizon_start: body.time_horizon_start || now,
      time_horizon_end: body.time_horizon_end || new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: body.priority ?? 1,
      risk_tolerance: body.risk_tolerance || "MODERATE",
      budget_allocated_bdt: Number(body.budget_allocated_bdt ?? 0),
      budget_spent_bdt: 0,
      allowed_domains: body.allowed_domains || ["COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE"],
      allowed_actions: body.allowed_actions || ["OPTIMIZE_PRICING", "REBALANCE_STOCK", "TRIGGER_CAMPAIGN"],
      required_approvals: body.required_approvals || ["HIGH_RISK_PRICING"],
      constraints: body.constraints || [],
      progress_percent: body.progress_percent ?? 0,
      forecast_achievement_percent: body.forecast_achievement_percent ?? null,
      created_by: context.user?.id || "admin",
      created_at: now,
      updated_at: now,
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
