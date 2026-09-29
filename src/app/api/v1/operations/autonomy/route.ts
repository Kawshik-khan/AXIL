import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";
import { withStore } from "@/lib/store-unit";

const BudgetPatch = z
  .object({
    daily_max_spend_bdt: z.number().finite().min(0).max(10_000_000),
    daily_max_actions: z.number().int().min(0).max(100_000),
    daily_max_llm_cost_usd: z.number().finite().min(0).max(10_000),
  })
  .partial()
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const budget = operationalBudgetService.getBudget(tenantId);
    return apiSuccess(budget);
  } catch (err) {
    return apiError(err);
  }
}

async function handlePUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_APPROVE);
    const tenantId = context.tenant.id;
    const body = parseOrThrow(BudgetPatch, await readJson(request));

    const updated = operationalBudgetService.updateBudget(tenantId, body);

    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PUT = withStore("PUT", handlePUT);
