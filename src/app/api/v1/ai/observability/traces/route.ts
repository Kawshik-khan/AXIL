import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const conversationId = searchParams.get("conversation_id") || undefined;
    const escalatedOnly = searchParams.get("escalated_only") === "true";

    let traces = db.getAgentExecutionTraces(context.tenant.id, limit, conversationId);
    if (escalatedOnly) {
      traces = traces.filter((t) => t.escalation_triggered);
    }

    return apiSuccess(traces, { total: traces.length, limit });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
