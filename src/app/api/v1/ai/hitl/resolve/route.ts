import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";

const ResolveBody = z
  .object({
    escalation_id: z.string().min(1),
    resolution_type: z.enum(["HUMAN_REPLIED", "DRAFT_APPROVED", "DRAFT_REJECTED", "BOT_RESUMED"]),
    resume_bot: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SUPPORT_WRITE);

    const body = ResolveBody.parse(await request.json());

    const resolved = HitlEscalationService.resolveEscalation(context.tenant.id, {
      escalationId: body.escalation_id,
      resolutionType: body.resolution_type,
      resumeBot: body.resume_bot,
      notes: body.notes,
      userId: context.user.id,
    });

    return apiSuccess(resolved);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
