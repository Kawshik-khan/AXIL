import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { AuditService } from "@/domains/audit/service";
import { db } from "@/infrastructure/db";
import { AUTH_COOKIE_NAME, PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";

const expired = { value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 };

/** "Sign out everywhere": revokes every workspace and platform session of the signed-in user (FX-15). */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    db.bumpSessionVersion(context.user.id);
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "SESSIONS_REVOKED",
      resourceType: "user",
      resourceId: context.user.id,
      metadata: {},
    });
    const response = apiSuccess({ message: "Signed out of every session." });
    response.cookies.set({ name: AUTH_COOKIE_NAME, ...expired });
    response.cookies.set({ name: PLATFORM_AUTH_COOKIE_NAME, ...expired });
    return response;
  } catch (err) {
    return apiError(err);
  }
}
