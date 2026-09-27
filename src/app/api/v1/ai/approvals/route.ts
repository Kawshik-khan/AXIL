import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const approvals = db.getApprovalRequests(context.tenant.id, status);
    return apiSuccess(approvals, { total: approvals.length });
  } catch (err) {
    return apiError(err);
  }
}
