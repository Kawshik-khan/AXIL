import { NextResponse } from "next/server";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";
import { enforceRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    // Sign-up limits (FX-14): 5 per client per hour behind a trusted proxy, and a global cap of 30 per hour.
    const client = clientKey(request);
    if (client) await enforceRateLimit(`register:client:${client}`, 5, 60 * MINUTE);
    await enforceRateLimit("register:global", 30, 60 * MINUTE); // always, so no header can lift the overall cap
    const body = await request.json();
    const result = await AuthService.registerTenantWithOwner(body);

    const response = apiSuccess(
      {
        user: result.user,
        tenant: result.tenant,
        role: result.role,
      },
      undefined,
      201
    );

    // Set secure HttpOnly session cookie
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
