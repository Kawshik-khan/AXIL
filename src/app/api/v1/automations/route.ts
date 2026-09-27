import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status") || undefined;

    const automations = AutomationRegistryService.listAutomations(context.tenant.id, {
      category,
      status,
    });

    return apiSuccess({ automations });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_CREATE);

    const body = await request.json();
    const automation = AutomationRegistryService.createAutomation(
      context.tenant.id,
      context.user.id,
      body
    );

    return apiSuccess({ automation }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
