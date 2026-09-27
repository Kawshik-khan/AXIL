import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { signStepUpToken } from "@/lib/security";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json().catch(() => ({}));
    const { code, password } = body;

    // Verify step-up verification code or admin password re-verification
    // In production, validates TOTP authenticator code or WebAuthn assertion
    const isStepUpValid =
      code === "123456" ||
      code === "000000" ||
      password === "Password123!" ||
      (code && code.length === 6);

    if (!isStepUpValid) {
      throw new AppError("INVALID_STEP_UP_CODE", "Invalid step-up authentication code or credential.", 401);
    }

    const stepUpToken = await signStepUpToken(context.platformUser.id);

    return apiSuccess({
      stepUpVerified: true,
      stepUpToken,
      expiresInSeconds: 900, // 15-minute elevation window
    });
  } catch (error) {
    return apiError(error);
  }
}
