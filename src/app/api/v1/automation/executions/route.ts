import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const { searchParams } = new URL(request.url);
    const automationId = searchParams.get("automation_id") || undefined;
    const status = searchParams.get("status") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;

    const executions = db.getAutomationExecutions(context.tenant.id, {
      automationId,
      status,
      limit,
    });

    return apiSuccess({ executions, total: executions.length });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
