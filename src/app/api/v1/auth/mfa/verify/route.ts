import { z } from "zod";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME, verifyWorkspaceMfaPendingToken } from "@/lib/security";
import { AppError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

// A 6-digit authenticator code, or a recovery code (XXXXX-XXXXX). WorkspaceMfaService decides which.
const Body = z
  .object({
    mfa_token: z.string().min(1).max(4096),
    code: z.string().trim().min(6, "Enter the code from your authenticator.").max(32),
  })
  .strict();

/**
 * Second step of workspace sign-in for accounts with an authenticator turned on: exchanges the 5-minute token from
 * /api/v1/auth/login and a valid code for a workspace session. Mirrors /api/v1/platform/auth/mfa/verify.
 */
async function handlePOST(request: Request) {
  try {
    const { mfa_token, code } = parseOrThrow(Body, await readJson(request));
    const pending = await verifyWorkspaceMfaPendingToken(mfa_token);
    if (!pending) {
      throw new AppError("MFA_TOKEN_INVALID", "Sign-in expired. Enter your email and password again.", 401);
    }
    // Per account, so a stolen password can't be paired with code guessing: 5 tries per 15 minutes.
    await enforceRateLimit(`wmfa:login:${pending.userId}`, 5, 15 * MINUTE);

    const result = await AuthService.completeMfaLogin(mfa_token, code);
    const response = apiSuccess({
      user: result.user,
      tenant: result.tenant,
      role: result.role,
    });
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);

