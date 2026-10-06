import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { stepUpEnforced } from "@/lib/step-up";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

/** The signed-in user's authenticator status (FX-97 Part A). Read-only; never returns secrets or recovery codes. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const user = db.findUserById(context.user.id);
    return apiSuccess({
      enrolled: WorkspaceMfaService.isEnrolled(context.user.id),
      enrolled_at: user?.mfa_enrolled_at ?? null,
      recovery_codes_left: user?.mfa_enabled ? (user.mfa_recovery_hashes ?? []).length : 0,
      step_up_enforced: stepUpEnforced(),
    });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
