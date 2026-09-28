/**
 * Support impersonation that actually works, and only under its rules (FIX_IMPLEMENTATION_PLAN FX-34 step 5).
 *
 * Starting a session (platform `support.impersonate` + step-up) sets an httpOnly, SameSite=Strict cookie. A tenant
 * request carrying it is served in the target workspace only if all of these hold:
 * - the impersonation token verifies (its own audience);
 * - the operator's own platform session is present and valid, and names the same operator (a copied impersonation
 *   cookie alone is useless);
 * - the session record exists, isn't revoked or expired, and matches the token;
 * - the target membership still exists.
 * The context's user is the operator (so actions are attributed to them), flagged `impersonation`. READ_ONLY sessions
 * get only `*.read` permissions and can't make any non-GET request.
 */
import { db } from "@/infrastructure/db";
import { verifyImpersonationToken, AUTH_COOKIE_NAME } from "@/lib/security";
import { ImpersonationExpiredError } from "@/lib/errors";
import { RbacService } from "@/domains/rbac/service";
import { randomSuffix } from "@/lib/ids";
import type { RequestContext } from "@/lib/context";
import type { PlatformContext } from "@/lib/context";

export const IMPERSONATION_COOKIE_NAME = "commerceos_impersonation";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The impersonated context, or null when the request carries no impersonation cookie. Throws when the cookie is
 * present but doesn't satisfy the rules above. `platformContextFor` resolves the operator's platform session.
 */
export async function resolveImpersonationContext(
  request: Request,
  requestId: string,
  platformContextFor: (request: Request) => Promise<PlatformContext>
): Promise<RequestContext | null> {
  // An explicit bearer token (API clients) is never overridden by a cookie
  if (request.headers.get("authorization")) return null;
  const token = readCookie(request, IMPERSONATION_COOKIE_NAME);
  if (!token) return null;

  const claims = await verifyImpersonationToken(token);
  if (!claims) throw new ImpersonationExpiredError();

  // The operator's own platform session, from the cookie only
  const cookieOnly = new Request(request.url, { headers: { cookie: request.headers.get("cookie") ?? "" } });
  let platform: PlatformContext;
  try {
    platform = await platformContextFor(cookieOnly);
  } catch {
    throw new ImpersonationExpiredError("The support session needs the operator's platform sign-in.");
  }
  if (platform.platformUser.id !== claims.operatorUserId) throw new ImpersonationExpiredError();

  const session = db.findImpersonationSessionById(claims.sessionId);
  if (
    !session ||
    session.revoked_at ||
    Date.parse(session.expires_at) <= Date.now() ||
    session.operator_user_id !== claims.operatorUserId ||
    session.target_tenant_id !== claims.targetTenantId ||
    session.target_user_id !== claims.targetUserId
  ) {
    throw new ImpersonationExpiredError();
  }

  const tenant = db.findTenantById(session.target_tenant_id);
  const membership = db.findMembership(session.target_tenant_id, session.target_user_id);
  if (!tenant || !membership) throw new ImpersonationExpiredError("The support session's workspace or member no longer exists.");

  const rolePermissions = RbacService.getPermissionsForRole(membership.role);
  const permissions = session.mode === "READ_ONLY" ? rolePermissions.filter((p) => p.endsWith(".read")) : rolePermissions;

  return {
    requestId,
    traceId: `trc_${randomSuffix()}`,
    user: {
      id: platform.platformUser.id,
      email: platform.platformUser.email,
      name: `${platform.platformUser.name} (support)`,
      status: "ACTIVE",
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
      timezone: tenant.timezone,
      language: tenant.language,
      status: tenant.status,
    },
    role: membership.role,
    permissions,
    timestamp: new Date().toISOString(),
    impersonation: {
      session_id: session.id,
      operator_user_id: session.operator_user_id,
      target_user_id: session.target_user_id,
      mode: session.mode,
      expires_at: session.expires_at,
    },
  };
}

/** Cookie attributes for the impersonation cookie (cleared with maxAge 0). */
export function impersonationCookie(value: string, maxAgeSeconds: number) {
  return {
    name: IMPERSONATION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// Re-exported for the session route: the tenant session cookie is untouched while impersonating
export { AUTH_COOKIE_NAME };
