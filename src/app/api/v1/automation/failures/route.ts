import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const executions = db.getAutomationExecutions(context.tenant.id);
    const failures = executions.filter(
      (e) => e.status === "FAILED" || e.status === "DEAD_LETTERED" || e.status === "RETRYING"
    );

    return apiSuccess({ failures, total: failures.length });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
