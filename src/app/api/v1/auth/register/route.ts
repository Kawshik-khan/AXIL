import { NextResponse } from "next/server";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";

export async function POST(request: Request) {
  try {
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
