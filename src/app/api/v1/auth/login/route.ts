import { NextResponse } from "next/server";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await AuthService.login(body.email, body.password, body.tenantId);

    const platformMembership = (await import("@/infrastructure/db")).db.findPlatformMembershipByUserId(result.user.id);

    const response = apiSuccess({
      user: result.user,
      tenant: result.tenant,
      role: result.role,
      isPlatformUser: !!(platformMembership && platformMembership.is_active),
      platformRole: platformMembership?.is_active ? platformMembership.role : undefined,
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

    // If user is also a platform operator, issue platform session cookie
    if (platformMembership && platformMembership.is_active) {
      const { signPlatformSessionToken, PLATFORM_AUTH_COOKIE_NAME } = await import("@/lib/security");
      const platToken = await signPlatformSessionToken({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.name,
        platformRole: platformMembership.role,
        // No second factor is checked at login (TOTP is FX-15); a stored `mfa_enabled` flag is not a verification.
        mfaVerified: false,
      });
      response.cookies.set({
        name: PLATFORM_AUTH_COOKIE_NAME,
        value: platToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 3600 * 8,
      });
    }

    return response;
  } catch (err) {
    return apiError(err);
  }
}
