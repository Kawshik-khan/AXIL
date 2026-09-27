import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";

/**
 * Starts TOTP setup for the signed-in operator (FX-15). The secret is returned once, for the authenticator app;
 * MFA stays off until /mfa/confirm receives a valid code.
 */
export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const enrollment = PlatformMfaService.startEnrollment(context.platformUser.id, context.platformUser.email);
    const response = apiSuccess(enrollment);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
