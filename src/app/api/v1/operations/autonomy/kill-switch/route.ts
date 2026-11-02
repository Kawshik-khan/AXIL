import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";
import { withStore } from "@/lib/store-unit";
import { requireStepUp } from "@/lib/step-up";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_APPROVE);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const { action, reason } = body;

    let budget;
    if (action === "CLEAR") {
      // Stopping is never slowed down; clearing the stop needs a fresh authenticator code (Stage 1 security review)
      requireStepUp(context, "CLEAR_AUTONOMY_KILL_SWITCH");
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

export const POST = withStore("POST", handlePOST);
