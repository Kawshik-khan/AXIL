import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;

    const templates = AutomationRegistryService.listTemplates(category);
    return apiSuccess({ templates, total: templates.length });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
