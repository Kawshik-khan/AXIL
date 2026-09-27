import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DASHBOARD_READ);

    const metrics = db.getDashboardMetrics(context.tenant.id);
    return apiSuccess({ metrics });
  } catch (err) {
    return apiError(err);
  }
}
