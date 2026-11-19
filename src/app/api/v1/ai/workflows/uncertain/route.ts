import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";
import { TaskStatus } from "@/types/orchestration";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const tasks = db
      .getTasks(context.tenant.id)
      .filter((task) => task.status === TaskStatus.OUTCOME_UNKNOWN);

    return apiSuccess({ tasks });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
