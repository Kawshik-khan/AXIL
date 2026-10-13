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
    // A takeover changes a customer conversation: manage permission (SA-6) and a recorded reason (security review M7)
    PrivilegedActionGate.assert(context, "ai.hitl.takeover", {
      reason: body.reason,
      payload: { escalation_id: body.escalation_id, action: body.action },
    });

    let result;
    if (body.action === "CLAIM") {
      result = HitlEscalationService.claimEscalation(
        body.tenant_id,
        body.escalation_id,
        context.platformUser.id
      );
    } else {
      result = HitlEscalationService.resolveEscalation(body.tenant_id, {
        escalationId: body.escalation_id,
        resolutionType: body.resolution_type || "HUMAN_REPLIED",
        notes: body.notes || body.reason,
        resumeBot: body.resume_bot,
        userId: context.platformUser.id,
      });
    }

    PlatformAuditService.record(
      {
        action: `platform.ai.hitl.${body.action.toLowerCase()}`,
        resource_type: "hitl_escalation",
        resource_id: body.escalation_id,
        target_tenant_id: body.tenant_id,
        reason: body.reason,
        result: "SUCCESS",
      },
      context
    );

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
