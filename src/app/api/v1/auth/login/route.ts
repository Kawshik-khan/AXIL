import { NextResponse } from "next/server";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";
import { enforceRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const body = await request.json();
    // Brute-force limits (FX-14): per account always, per client when a trusted proxy identifies it.
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    await enforceRateLimit(`login:tenant:email:${email}`, 10, 15 * MINUTE);
    const client = clientKey(request);
    if (client) await enforceRateLimit(`login:tenant:client:${client}`, 50, 15 * MINUTE);
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

    // Platform operators sign in to the control plane separately at /super-admin/login, where TOTP applies. The
    // workspace login no longer issues a platform session (it bypassed the operator MFA step, FX-15).

    return response;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
