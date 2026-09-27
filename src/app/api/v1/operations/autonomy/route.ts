import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;

    const budget = operationalBudgetService.getBudget(tenantId);
    return apiSuccess(budget);
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const updated = operationalBudgetService.updateBudget(tenantId, {
      daily_max_spend_bdt: body.daily_max_spend_bdt,
      daily_max_actions: body.daily_max_actions,
      daily_max_llm_cost_usd: body.daily_max_llm_cost_usd,
    });

    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
