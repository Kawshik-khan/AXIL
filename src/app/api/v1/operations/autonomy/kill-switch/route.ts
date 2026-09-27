import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const { action, reason } = body;

    let budget;
    if (action === "CLEAR") {
      budget = operationalBudgetService.clearKillSwitch(tenantId);
    } else {
      budget = operationalBudgetService.triggerKillSwitch(
        tenantId,
        reason || "Emergency kill switch manually activated by operator"
      );
    }

    return apiSuccess({
      kill_switch_active: budget.emergency_stopped,
      budget,
    });
  } catch (err) {
    return apiError(err);
  }
}
