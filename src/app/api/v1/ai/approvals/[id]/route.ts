import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { approvalEngine } from "@/domains/ai/orchestration/autonomy/approval-engine";
import { BadRequestError } from "@/lib/errors";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const body = await request.json();
    const action = body.action?.toUpperCase();

    if (action === "APPROVE") {
      const result = await approvalEngine.approveAction(params.id, context.user.name || context.user.email);
      if (!result.success) {
        return apiSuccess({
          success: false,
          stale: result.stale || false,
          reason: result.reason,
          approval: result.approval,
        }, undefined, 409);
      }
      return apiSuccess(result);
    } else if (action === "REJECT") {
      const reason = body.reason || "Rejected by operator";
      const result = await approvalEngine.rejectAction(
        params.id,
        context.user.name || context.user.email,
        reason
      );
      return apiSuccess(result);
    } else {
      throw new BadRequestError(`Invalid approval action: ${action}. Expected APPROVE or REJECT.`);
    }
  } catch (err) {
    return apiError(err);
  }
}
