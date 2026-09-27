import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { TenantService } from "@/domains/tenants/service";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";

export async function PATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);

    const body = await request.json();
    const updated = TenantService.updateTenantSettings(context.tenant.id, body);

    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "SETTINGS_UPDATED",
      resourceType: "tenant",
      resourceId: context.tenant.id,
      metadata: body,
    });

    return apiSuccess({ tenant: updated });
  } catch (err) {
    return apiError(err);
  }
}
