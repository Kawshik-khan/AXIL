import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const { searchParams } = new URL(request.url);

    const actorAgent = searchParams.get("actor_agent");
    const status = searchParams.get("status");

    let receipts = db.getActionReceipts(tenantId);
    if (actorAgent) receipts = receipts.filter((r) => r.actor_agent === actorAgent);
    if (status) receipts = receipts.filter((r) => r.status === status);

    return apiSuccess({
      total: receipts.length,
      receipts: receipts.slice(0, 100),
    });
  } catch (err) {
    return apiError(err);
  }
}
