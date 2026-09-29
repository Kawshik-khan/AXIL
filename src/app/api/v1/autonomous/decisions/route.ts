import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { globalDecisionEngineService } from "@/domains/autonomous/services";
import { DecisionStatus } from "@/types/autonomous";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DECISIONS_READ);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as DecisionStatus | null;
    const decisions = globalDecisionEngineService.getDecisions(context.tenant.id, status || undefined);
    return apiSuccess({
      total: decisions.length,
      pending_approval: decisions.filter((d) => d.status === "AWAITING_APPROVAL").length,
      decisions,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
