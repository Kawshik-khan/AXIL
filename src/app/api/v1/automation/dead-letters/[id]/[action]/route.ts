import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { DeadLetterService } from "@/domains/automation/services/dead-letter.service";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; action: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const action = params.action.toLowerCase();
    const body = await request.json().catch(() => ({}));

    if (action === "retry") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_RETRY);
      const result = await DeadLetterService.retryDeadLetter(
        context.tenant.id,
        params.id,
        context.user.id
      );
      return apiSuccess(result);
    }

    if (action === "cancel") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_RETRY);
      const result = DeadLetterService.cancelDeadLetter(
        context.tenant.id,
        params.id,
        context.user.id,
        body.reason
      );
      return apiSuccess({ deadLetter: result });
    }

    if (action === "resolve") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_RETRY);
      const result = DeadLetterService.resolveDeadLetter(
        context.tenant.id,
        params.id,
        context.user.id,
        body.notes || "Resolved by operator"
      );
      return apiSuccess({ deadLetter: result });
    }

    throw new BadRequestError(`Unknown action: ${params.action}`);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
