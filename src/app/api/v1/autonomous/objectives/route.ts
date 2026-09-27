import { newId, randomSuffix } from "@/lib/ids";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { businessObjectivesService } from "@/domains/autonomous/services";
import { ObjectiveStatus } from "@/types/autonomous";

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

    const created = businessObjectivesService.createObjective({
      id: newId("obj"), // never a client-chosen id (it could overwrite or collide with another record)
      tenant_id: context.tenant.id,
      organization_id: body.organization_id,
      parent_objective_id: body.parent_objective_id,
      hierarchy_level: body.hierarchy_level || "ENTERPRISE",
      scope_entity_id: body.scope_entity_id,
      name: body.name || body.title,
      description: body.description,
      status: body.status || "ACTIVE",
      target_metric: body.target_metric || "REVENUE_BDT",
      target_value: body.target_value ?? 1000000,
      current_value: body.current_value ?? body.baseline_value ?? 500000,
      baseline_value: body.baseline_value ?? 500000,
      unit: body.unit || "BDT",
      time_horizon_start: body.time_horizon_start || now,
      time_horizon_end: body.time_horizon_end || new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: body.priority ?? 1,
      risk_tolerance: body.risk_tolerance || "MODERATE",
      budget_allocated_bdt: body.budget_allocated_bdt ?? 50000,
      budget_spent_bdt: 0,
      allowed_domains: body.allowed_domains || ["COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE"],
      allowed_actions: body.allowed_actions || ["OPTIMIZE_PRICING", "REBALANCE_STOCK", "TRIGGER_CAMPAIGN"],
      required_approvals: body.required_approvals || ["HIGH_RISK_PRICING"],
      constraints: body.constraints || [],
      progress_percent: body.progress_percent ?? 0,
      forecast_achievement_percent: body.forecast_achievement_percent ?? 60,
      created_by: context.user?.id || "admin",
      created_at: now,
      updated_at: now,
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
