import { z } from "zod";
import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";
import { db } from "@/infrastructure/db";
import { verifyPassword } from "@/lib/security";
import { AppError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ password: z.string().min(1).max(200) }).strict();

/**
 * Starts TOTP setup for the signed-in operator (FX-15). Requires the operator's password again, so a stolen session
 * alone can't bind an attacker's authenticator. The secret is returned once; MFA stays off until /mfa/confirm.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    await enforceRateLimit(`mfa:enroll:${context.platformUser.id}`, 5, 15 * MINUTE);
    const { password } = parseOrThrow(Body, await readJson(request));
    const user = db.findUserById(context.platformUser.id);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      // 400, not 401: the session is valid; only the confirmation failed (a 401 would sign the console out).
      throw new AppError("INVALID_PASSWORD", "The password is not correct.", 400);
    }
    const enrollment = PlatformMfaService.startEnrollment(context.platformUser.id, context.platformUser.email);
    const response = apiSuccess(enrollment);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
