import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const workflows = db.getAutomationWorkflows(context.tenant.id);
    return apiSuccess({ workflows });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
