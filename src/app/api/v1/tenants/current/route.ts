import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { TenantService } from "@/domains/tenants/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.WORKSPACE_READ);

    const tenant = TenantService.getTenantById(context.tenant.id);
    return apiSuccess({ tenant });
  } catch (err) {
    return apiError(err);
  }
}
