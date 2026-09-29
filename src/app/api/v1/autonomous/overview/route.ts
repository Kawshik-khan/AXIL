import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { autonomousControlPlaneService } from "@/domains/autonomous/services";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTONOMOUS_READ);
    const overview = autonomousControlPlaneService.getAutonomousOverview(context.tenant.id);
    return apiSuccess(overview);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
