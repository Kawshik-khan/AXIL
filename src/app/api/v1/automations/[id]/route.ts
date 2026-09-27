import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const automation = AutomationRegistryService.getAutomationById(
      context.tenant.id,
      params.id
    );

    if (!automation) {
      throw new NotFoundError(`Automation '${params.id}' not found.`);
    }

    return apiSuccess({ automation });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_UPDATE);

    const body = await request.json();
    const updated = AutomationRegistryService.updateAutomation(
      context.tenant.id,
      params.id,
      context.user.id,
      body
    );

    return apiSuccess({ automation: updated });
  } catch (err) {
    return apiError(err);
  }
}
