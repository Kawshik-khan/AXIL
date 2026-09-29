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
    const agent_id = searchParams.get("agent_id") || undefined;
    const conversation_id = searchParams.get("conversation_id") || undefined;
    const status = searchParams.get("status") || undefined;

    const runs = db.getAgentRuns(context.tenant.id, {
      conversation_id,
      status,
    });

    const filtered = agent_id ? runs.filter(r => r.agent_type === agent_id) : runs;

    return apiSuccess(filtered, { total: filtered.length });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
