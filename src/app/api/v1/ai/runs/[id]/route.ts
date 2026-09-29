import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const run = db.findAgentRunById(context.tenant.id, params.id);
    if (!run) {
      throw new AppError("NOT_FOUND", `Agent run ${params.id} not found`, 404);
    }

    const toolCalls = db.getAgentToolCalls(context.tenant.id, params.id);

    return apiSuccess({
      ...run,
      tool_calls: toolCalls,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
