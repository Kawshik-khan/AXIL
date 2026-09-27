import { apiError, extractPlatformContext } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

/**
 * Step-up elevation for HIGH/CRITICAL platform actions.
 *
 * STATUS: TARGET — no real second factor (TOTP/WebAuthn) exists yet, so this endpoint fails closed and never
 * issues a step-up token (rules/security.md §2, rules/privileged-actions.md §3.4, audit H10). Until FX-15 lands,
 * actions that call PlatformAuthorizationService.assertStepUp() stay blocked with StepUpRequiredError.
 */
export async function POST(request: Request) {
  try {
    await extractPlatformContext(request); // unauthenticated callers still get 401
    throw new AppError(
      "STEP_UP_NOT_AVAILABLE",
      "Step-up verification needs a TOTP or WebAuthn factor, which is not implemented yet. HIGH and CRITICAL platform actions stay disabled until it is.",
      501
    );
  } catch (error) {
    return apiError(error);
  }
}
