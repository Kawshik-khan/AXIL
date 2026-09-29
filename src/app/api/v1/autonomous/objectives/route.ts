import { z } from "zod";
import { newId } from "@/lib/ids";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { businessObjectivesService } from "@/domains/autonomous/services";
import { ObjectiveStatus } from "@/types/autonomous";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
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

/** Domains the autonomous engines understand; an objective can only enable these. */
const OBJECTIVE_DOMAINS = [
  "COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE",
  "PRICING", "MARKETING", "INVENTORY", "PROCUREMENT", "FULFILLMENT", "FINANCE", "SUPPORT",
] as const;
const OBJECTIVE_ACTIONS = ["OPTIMIZE_PRICING", "REBALANCE_STOCK", "TRIGGER_CAMPAIGN"] as const;
/** Approvals every objective keeps; a request can add to them, never remove them (N15). */
const BASELINE_APPROVALS = ["HIGH_RISK_PRICING", "BUDGET_OVERRUN"] as const;

const CreateObjective = z
  .object({
    name: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    organization_id: z.string().optional(),
    parent_objective_id: z.string().optional(),
    hierarchy_level: z.enum(["ENTERPRISE", "BUSINESS_UNIT", "BRAND", "STORE", "DOMAIN", "WORKFLOW", "AGENT_TASK"]).optional(),
    scope_entity_id: z.string().optional(),
    target_metric: z.string().trim().min(1).optional(),
    target_value: z.coerce.number().finite(),
    baseline_value: z.coerce.number().finite().optional(),
    current_value: z.coerce.number().finite().optional(),
    unit: z.string().trim().min(1).optional(),
    time_horizon_start: z.string().datetime().optional(),
    time_horizon_end: z.string().datetime().optional(),
    priority: z.number().int().min(1).max(10).optional(),
    risk_tolerance: z.enum(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]).optional(),
    budget_allocated_bdt: z.number().nonnegative().optional(),
    allowed_domains: z.array(z.enum(OBJECTIVE_DOMAINS)).min(1).optional(),
    allowed_actions: z.array(z.enum(OBJECTIVE_ACTIONS)).optional(),
    required_approvals: z.array(z.string().trim().min(1)).optional(),
    constraints: z
      .array(
        z
          .object({
            type: z.enum(["BUDGET", "MARGIN", "RISK", "TIME", "INVENTORY", "APPROVAL", "POLICY", "CUSTOM"]),
            name: z.string().min(1),
            operator: z.enum(["MIN", "MAX", "EQUALS", "BETWEEN", "NOT_EXCEEDS"]),
            value: z.number(),
            unit: z.string().optional(),
            description: z.string().optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

/**
 * Creates an objective from a strict body (N15). The body used to set `status`, progress and forecast, drop the
 * required approvals to none, enable any domain string, point at another workspace's organization, and fall back to
 * "admin" as the creator. Now: new objectives start PROPOSED with no progress, the baseline approvals always apply, the
 * organization and parent must be this workspace's, and the creator is the signed-in user.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OBJECTIVES_MANAGE);
    const body = CreateObjective.parse(await request.json());
    const now = new Date().toISOString();
    // An objective's numbers are the merchant's, never invented defaults (FX-30: were 10,00,000 / 5,00,000 / 50,000 / 60%)
    const name = body.name || body.title;
    const baseline = body.baseline_value ?? body.current_value;
    if (!name || baseline === undefined) {
      throw new ValidationError("name, target_value and baseline_value (or current_value) are required.");
    }
    const organizationId = body.organization_id ? resolveOrganizationId(context, body.organization_id) : undefined;
    if (body.parent_objective_id && !businessObjectivesService.findById(context.tenant.id, body.parent_objective_id)) {
      throw new NotFoundError("Parent objective", body.parent_objective_id);
    }

    const created = businessObjectivesService.createObjective({
      id: newId("obj"), // never a client-chosen id (it could overwrite or collide with another record)
      tenant_id: context.tenant.id,
      organization_id: organizationId,
      parent_objective_id: body.parent_objective_id,
      hierarchy_level: body.hierarchy_level || "ENTERPRISE",
      scope_entity_id: body.scope_entity_id,
      name,
      description: body.description ?? "",
      status: "PROPOSED",
      target_metric: body.target_metric || "REVENUE_BDT",
      target_value: body.target_value,
      current_value: body.current_value ?? baseline,
      baseline_value: baseline,
      unit: body.unit || "BDT",
      time_horizon_start: body.time_horizon_start || now,
      time_horizon_end: body.time_horizon_end || new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: body.priority ?? 1,
      risk_tolerance: body.risk_tolerance || "MODERATE",
      budget_allocated_bdt: body.budget_allocated_bdt ?? 0,
      budget_spent_bdt: 0,
      allowed_domains: body.allowed_domains || ["COMMERCE", "OPERATIONS", "INTELLIGENCE", "GROWTH", "ENTERPRISE"],
      allowed_actions: body.allowed_actions || ["OPTIMIZE_PRICING", "REBALANCE_STOCK", "TRIGGER_CAMPAIGN"],
      required_approvals: Array.from(new Set<string>([...BASELINE_APPROVALS, ...(body.required_approvals ?? [])])),
      constraints: body.constraints || [],
      progress_percent: 0,
      forecast_achievement_percent: null,
      created_by: context.user.id,
      created_at: now,
      updated_at: now,
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
