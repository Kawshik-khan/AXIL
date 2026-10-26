import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuditService } from "@/domains/platform/services/platform-audit.service";
import { PrivilegedActionGate } from "@/domains/platform/services/privileged-action-gate";
import { parseOrThrow, readJson } from "@/lib/validation";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";
import { withStore } from "@/lib/store-unit";

const TakeoverBody = z
  .object({
    tenant_id: z.string().min(1),
    escalation_id: z.string().min(1),
    action: z.enum(["CLAIM", "RESOLVE"]),
    notes: z.string().max(500).optional(),
    resolution_type: z
      .enum(["HUMAN_REPLIED", "DRAFT_APPROVED", "DRAFT_REJECTED", "BOT_RESUMED"])
      .optional(),
    resume_bot: z.boolean().optional(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(TakeoverBody, await readJson(request));
    // A platform operator names the workspace they act on (authorized by the platform context and the privileged-action gate)
    const { tenant_id: targetTenantId } = body;
    // A takeover changes a customer conversation: manage permission (SA-6) and a recorded reason (security review M7)
    PrivilegedActionGate.assert(context, "ai.hitl.takeover", {
      reason: body.reason,
      // resume_bot hands the chat back to the tenant's agent, which may then message the customer: gate and audit it
      payload: { escalation_id: body.escalation_id, action: body.action, resume_bot: body.resume_bot === true },
    });

    let result;
    if (body.action === "CLAIM") {
      result = HitlEscalationService.claimEscalation(
        targetTenantId,
        body.escalation_id,
        context.platformUser.id,
        { platformOperator: true }
      );
    } else {
      result = HitlEscalationService.resolveEscalation(targetTenantId, {
        escalationId: body.escalation_id,
        resolutionType: body.resolution_type || "HUMAN_REPLIED",
        notes: body.notes || body.reason,
        resumeBot: body.resume_bot,
        userId: context.platformUser.id,
        platformOperator: true,
      });
    }

    PlatformAuditService.record(
      {
        action: `platform.ai.hitl.${body.action.toLowerCase()}`,
        resource_type: "hitl_escalation",
        resource_id: body.escalation_id,
        target_tenant_id: targetTenantId,
        reason: body.reason,
        result: "SUCCESS",
        after_state: { resume_bot: body.resume_bot === true },
      },
      context
    );

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
