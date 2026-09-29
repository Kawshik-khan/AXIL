import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRouterService } from "@/domains/automation/services/automation-router.service";
import { CommerceEvent } from "@/types/commerce";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_EXECUTE);

    const event = (await request.json()) as CommerceEvent;
    if (!event.tenant_id) {
      event.tenant_id = context.tenant.id;
    }

    const routed = await AutomationRouterService.routeEvent(event);
    return apiSuccess({ routed, count: routed.length });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
