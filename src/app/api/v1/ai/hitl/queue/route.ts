import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";
import type { EscalationPriority, EscalationStatus } from "@/types/ai";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SUPPORT_READ);

    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") as EscalationStatus) || undefined;
    const priority = (searchParams.get("priority") as EscalationPriority) || undefined;

    const queue = HitlEscalationService.getQueue(context.tenant.id, {
      status,
      priority,
    });

    return apiSuccess(queue, { total: queue.length });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
