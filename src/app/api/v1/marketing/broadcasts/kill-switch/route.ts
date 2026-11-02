import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";
import { requireStepUp } from "@/lib/step-up";

const KillSwitchSchema = z.object({
  active: z.boolean(),
});

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_APPROVE);
    const body = await request.json();
    const validated = KillSwitchSchema.parse(body);
    // Stopping is never slowed down; resuming sends needs a fresh authenticator code (Stage 1 security review)
    if (!validated.active) requireStepUp(context, "RESUME_BROADCASTS");

    const result = marketingService.toggleKillSwitch(context.tenant.id, validated.active);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
