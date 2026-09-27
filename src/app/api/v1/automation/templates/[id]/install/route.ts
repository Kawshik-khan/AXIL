import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_CREATE);

    const body = await request.json().catch(() => ({}));
    const installed = AutomationRegistryService.installTemplate(
      context.tenant.id,
      params.id,
      context.user.id,
      body.configuration
    );

    return apiSuccess(installed, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
