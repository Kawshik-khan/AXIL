import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { IMPERSONATION_COOKIE_NAME, impersonationCookie, readCookie } from "@/lib/impersonation";
import { verifyImpersonationToken } from "@/lib/security";
import { PlatformSupportService } from "@/domains/platform";

/**
 * Ends the support session this browser is in (FX-34 step 5): revokes it (as the operator) and clears the cookie.
 * The cookie is cleared even if the session can no longer be revoked (expired, or the operator signed out).
 */
export async function DELETE(request: Request) {
  try {
    const token = readCookie(request, IMPERSONATION_COOKIE_NAME);
    let revoked = false;
    if (token) {
      const claims = await verifyImpersonationToken(token);
      if (claims) {
        try {
          const platform = await extractPlatformContext(new Request(request.url, { headers: { cookie: request.headers.get("cookie") ?? "" } }));
          if (platform.platformUser.id === claims.operatorUserId) {
            PlatformSupportService.revokeSession(claims.sessionId, "Support session ended from the workspace", platform);
            revoked = true;
          }
        } catch {
          // operator no longer signed in: the session simply expires; the cookie is still removed below
        }
      }
    }
    const response = apiSuccess({ ended: true, revoked });
    response.cookies.set(impersonationCookie("", 0));
    return response;
  } catch (err) {
    return apiError(err);
  }
}
