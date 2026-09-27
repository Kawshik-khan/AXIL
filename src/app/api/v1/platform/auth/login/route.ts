import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { signPlatformSessionToken, verifyPassword, PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const PLATFORM_SESSION_SECONDS = 4 * 60 * 60; // matches the platform token lifetime (rules/platform-security.md §3)

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomUUID(), 10);

const invalidCredentials = () =>
  new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);

export async function POST(request: Request) {
  try {
    const parsed = LoginBody.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new AppError("INVALID_CREDENTIALS", "Email and password are required.", 400);
    }
    const { email, password } = parsed.data;

    // Password first (bcrypt only — audit C8), membership second, so the endpoint does not reveal which
    // emails belong to platform operators.
    const user = db.findUserByEmail(email);
    const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_BCRYPT_HASH);
    if (!user || !passwordOk) {
      if (user) {
        db.recordPlatformSecurityEvent({
          id: `sec_fail_${crypto.randomUUID()}`,
          event_type: "FAILED_LOGIN",
          severity: "HIGH",
          actor_id: user.id,
          description: "Failed platform login attempt",
          created_at: new Date().toISOString(),
        });
      }
      throw invalidCredentials();
    }
    if (user.status !== "ACTIVE") {
      throw invalidCredentials();
    }

    const platformMembership = db.findPlatformMembershipByUserId(user.id);
    if (!platformMembership || !platformMembership.is_active) {
      throw new AppError("PLATFORM_MEMBERSHIP_REQUIRED", "Account is not authorized for Platform Control Plane access.", 403);
    }

    // No second factor is verified here yet (step-up TOTP is FIX_IMPLEMENTATION_PLAN FX-15), so the session
    // is not marked MFA-verified.
    const token = await signPlatformSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: platformMembership.role,
      mfaVerified: false,
    });

    // The token travels only in the httpOnly cookie; it is not returned in the JSON body.
    const response = apiSuccess({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: platformMembership.role,
        permissions: PLATFORM_ROLE_PERMISSIONS[platformMembership.role] || [],
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
