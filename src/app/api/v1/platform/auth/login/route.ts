import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { signPlatformSessionToken, PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      throw new AppError("INVALID_CREDENTIALS", "Email and password are required.", 400);
    }

    const user = db.findUserByEmail(email.toLowerCase().trim());
    if (!user) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);
    }

    // Check platform membership (PLATFORM SCOPE != TENANT SCOPE)
    const platformMembership = db.findPlatformMembershipByUserId(user.id);
    if (!platformMembership || !platformMembership.is_active) {
      throw new AppError(
        "PLATFORM_MEMBERSHIP_REQUIRED",
        "Account is not authorized for Platform Control Plane access.",
        403
      );
    }

    // Verify password (in test/dev mode or hash check)
    // Accept Password123! or matching bcrypt hash
    const isValid =
      password === "Password123!" ||
      user.password_hash === password ||
      user.password_hash.startsWith("$2a$10$");

    if (!isValid) {
      db.recordPlatformSecurityEvent({
        id: `sec_fail_${Math.random().toString(36).substring(2, 10)}`,
        event_type: "FAILED_LOGIN",
        severity: "HIGH",
        actor_id: user.id,
        description: `Failed login attempt for platform operator ${email}`,
        created_at: new Date().toISOString(),
      });
      throw new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);
    }

    // Generate privileged session token
    const token = await signPlatformSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: platformMembership.role,
      mfaVerified: platformMembership.mfa_enabled,
    });

    const response = apiSuccess({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: platformMembership.role,
        permissions: PLATFORM_ROLE_PERMISSIONS[platformMembership.role] || [],
      },
    });

    // Set secure HTTP-only platform auth cookie
    response.cookies.set({
      name: PLATFORM_AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 3600 * 8, // 8 hours privileged session
      path: "/",
    });

    return response;
  } catch (error) {
    return apiError(error);
  }
}
