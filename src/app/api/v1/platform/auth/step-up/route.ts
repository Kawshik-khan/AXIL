import { z } from "zod";
import { apiError, apiSuccess, extractPlatformContext } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";
import { signStepUpToken } from "@/lib/security";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const Body = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator."),
    action: z.string().max(100).optional(),
  })
  .strict();

/**
 * Step-up elevation for HIGH/CRITICAL platform actions (FX-15, audit H10).
 * Requires an enrolled TOTP authenticator and a fresh, unused code. Returns a 5-minute step-up token that the console
 * sends as `x-step-up-token`; PlatformAuthorizationService.assertStepUp() accepts nothing else.
 */
export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request); // unauthenticated callers get 401
    enforceRateLimit(`mfa:step-up:${context.platformUser.id}`, 5, 15 * MINUTE);
    if (!PlatformMfaService.isEnrolled(context.platformUser.id)) {
      throw new AppError("MFA_NOT_ENROLLED", "Set up an authenticator app before using step-up.", 409);
    }
    const { code, action } = parseOrThrow(Body, await readJson(request));
    if (!PlatformMfaService.verifyCode(context.platformUser.id, code)) {
      logger.warn("platform.step_up_failed", { user_id: context.platformUser.id });
      throw new AppError("INVALID_MFA_CODE", "The authenticator code is not valid.", 401);
    }
    const stepUpToken = await signStepUpToken(context.platformUser.id, action || "PRIVILEGED_ACTION");
    logger.info("platform.step_up_granted", { user_id: context.platformUser.id, action: action || "PRIVILEGED_ACTION" });
    const response = apiSuccess({ stepUpToken, expires_in: 300 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
