import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { approvalEngine } from "@/domains/ai/orchestration/autonomy/approval-engine";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";
import { requireStepUp } from "@/lib/step-up";
import { parseOrThrow, readJson } from "@/lib/validation";

// Strict body (ADR-104); a non-string action used to crash with 500 (Stage 1 security review)
const Body = z
  .object({
    action: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(["APPROVE", "REJECT"])),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const body = parseOrThrow(Body, await readJson(request));
    const action = body.action;

    if (action === "APPROVE") {
      requireStepUp(context, "APPROVE_AI_ACTION"); // a fresh authenticator code (FX-97 Part A; audit F30)
      const result = await approvalEngine.approveAction(context.tenant.id, params.id, context.user.id);
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
        context.tenant.id,
        params.id,
        context.user.id,
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

export const POST = withStore("POST", handlePOST);
