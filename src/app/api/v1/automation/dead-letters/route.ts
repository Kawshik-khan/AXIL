import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { DeadLetterService } from "@/domains/automation/services/dead-letter.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_VIEW_LOGS);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const deadLetters = DeadLetterService.listDeadLetters(context.tenant.id, status);
    return apiSuccess({ deadLetters, total: deadLetters.length });
  } catch (err) {
    return apiError(err);
  }
}
