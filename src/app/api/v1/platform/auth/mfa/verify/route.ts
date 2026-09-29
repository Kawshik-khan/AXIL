import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";
import { PLATFORM_AUTH_COOKIE_NAME, signPlatformSessionToken, verifyMfaPendingToken } from "@/lib/security";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ mfa_token: z.string().min(1).max(4096), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const PLATFORM_SESSION_SECONDS = 4 * 60 * 60;

/**
 * Second step of operator sign-in (FX-15): exchanges the short-lived token from /platform/auth/login and a valid
 * TOTP code for a platform session marked MFA-verified.
 */
async function handlePOST(request: Request) {
  try {
    const { mfa_token, code } = parseOrThrow(Body, await readJson(request));
    const pending = await verifyMfaPendingToken(mfa_token);
    if (!pending) {
      throw new AppError("MFA_TOKEN_INVALID", "Sign-in expired. Enter your email and password again.", 401);
    }
    enforceRateLimit(`mfa:verify:${pending.userId}`, 5, 15 * MINUTE);

    const user = db.findUserById(pending.userId);
    const membership = db.findPlatformMembershipByUserId(pending.userId);
    if (!user || user.status !== "ACTIVE" || !membership?.is_active || pending.sv !== (user.session_version ?? 1)) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);
    }
    if (!PlatformMfaService.verifyCode(user.id, code)) {
      throw new AppError("INVALID_MFA_CODE", "The authenticator code is not valid.", 401);
    }

    const token = await signPlatformSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: membership.role,
      mfaVerified: true, // a TOTP code was checked just now
      sv: user.session_version ?? 1,
    });
    const response = apiSuccess({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        permissions: PLATFORM_ROLE_PERMISSIONS[membership.role] || [],
      },
    });
    response.cookies.set({
      name: PLATFORM_AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PLATFORM_SESSION_SECONDS,
      path: "/",
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
