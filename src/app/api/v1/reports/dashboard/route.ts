import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DASHBOARD_READ);

    const metrics = db.getDashboardMetrics(context.tenant.id);
    return apiSuccess({ metrics });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
