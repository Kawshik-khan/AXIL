import { NextResponse } from "next/server";
import {
  AppError,
  PlatformAuthRequiredError,
  PlatformScopeRequiredError,
  PlatformPermissionDeniedError,
} from "@/lib/errors";
import {
  AUTH_COOKIE_NAME,
  PLATFORM_AUTH_COOKIE_NAME,
  verifyPlatformSessionToken,
  verifyStepUpToken,
} from "@/lib/security";
import { AuthService } from "@/domains/auth/service";
import {
  RequestContext,
  PlatformContext,
  PlatformRole,
  hasPlatformPermission,
} from "@/lib/context";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import {
  PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
} from "@/lib/permissions";

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status }
  );
}

export function apiError(error: unknown, requestId?: string) {
  const reqId = requestId || `req_${Math.random().toString(36).substring(2, 10)}`;

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          request_id: reqId,
        },
      },
      { status: error.statusCode }
    );
  }

  // Fallback for unhandled unexpected exceptions
  const message = error instanceof Error ? error.message : "An unexpected server error occurred.";
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message,
        request_id: reqId,
      },
    },
    { status: 500 }
  );
}

export async function extractRequestContext(request: Request): Promise<RequestContext> {
  const requestId = request.headers.get("x-request-id") || `req_${Math.random().toString(36).substring(2, 10)}`;

  // Check Authorization Bearer header
  let token: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // Check Cookie if header is missing
  if (!token) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]*)`));
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }
  }

  if (!token) {
    const devContext = devAuthBypassContext(requestId);
    if (devContext) return devContext;
    throw new AppError("AUTHENTICATION_REQUIRED", "No authentication session token provided.", 401);
  }

  // A presented token is always verified; an invalid or expired token is never replaced by a fallback identity (audit H1).
  return AuthService.resolveRequestContext(token, requestId);
}

/**
 * Local-development convenience, off by default (audit H1, ADR-103).
 * Applies only when NODE_ENV=development AND DEV_AUTH_BYPASS=1 AND the request carries no token at all.
 * Serves the request as the demo workspace owner (admin@commerceos.io) — never as a platform operator.
 */
function devAuthBypassContext(requestId: string): RequestContext | null {
  if (process.env.NODE_ENV !== "development" || process.env.DEV_AUTH_BYPASS !== "1") {
    return null;
  }
  const devTenant = db.findTenantById("ten_default_dhaka");
  const devUser = db.findUserByEmail("admin@commerceos.io");
  if (!devTenant || !devUser || devUser.status !== "ACTIVE" || !db.findMembership(devTenant.id, devUser.id)) {
    return null;
  }
  logger.warn("auth.dev_bypass_used", { request_id: requestId, tenant_id: devTenant.id });
  return {
    requestId,
    traceId: `trc_dev_${crypto.randomUUID()}`,
    user: {
      id: devUser.id,
      email: devUser.email,
      name: devUser.name,
      status: devUser.status,
    },
    tenant: {
      id: devTenant.id,
      name: devTenant.name,
      slug: devTenant.slug,
      currency: devTenant.currency,
      timezone: devTenant.timezone,
      language: devTenant.language,
      status: devTenant.status,
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };
}

export async function extractPlatformContext(request: Request): Promise<PlatformContext> {
  const requestId = request.headers.get("x-request-id") || `req_plat_${Math.random().toString(36).substring(2, 10)}`;
  const traceId = request.headers.get("x-trace-id") || `trc_plat_${Math.random().toString(36).substring(2, 10)}`;

  let token: string | null = null;

  // 1. Check custom X-Platform-Token header
  const customHeader = request.headers.get("x-platform-token");
  if (customHeader) {
    token = customHeader;
  }

  // 2. Check Authorization Bearer header
  if (!token) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  // 3. Check Platform Cookie
  if (!token) {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PLATFORM_AUTH_COOKIE_NAME}=([^;]*)`));
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }
  }

  // Platform identity comes only from a verified platform session token. There is no header, query-flag, or
  // environment fallback that can grant a platform role in any environment (audit C3, H1; ADR-103).
  if (!token) {
    throw new PlatformAuthRequiredError("Platform session required. Please sign in at /super-admin/login.");
  }

  const claims = await verifyPlatformSessionToken(token);
  if (!claims) {
    throw new PlatformAuthRequiredError("Invalid or expired platform session. Please sign in again.");
  }

  const user = db.findUserById(claims.userId);
  if (!user || user.status !== "ACTIVE") {
    throw new PlatformAuthRequiredError("Platform operator account is suspended or not found.");
  }

  // The role is resolved from the stored membership, not from the token, so deactivation or a role change
  // takes effect immediately instead of when the token expires.
  const membership = db.findPlatformMembershipByUserId(user.id);
  if (!membership || !membership.is_active) {
    throw new PlatformScopeRequiredError("Account is not an active platform operator.");
  }
  const platformRole = membership.role as PlatformRole;
  const permissions = PLATFORM_ROLE_PERMISSIONS[platformRole] || [];

  // Step-up is recognised only from a signed step-up token issued to this operator.
  let stepUpVerified = false;
  const stepUpHeader = request.headers.get("x-step-up-token");
  if (stepUpHeader) {
    stepUpVerified = !!(await verifyStepUpToken(stepUpHeader, user.id));
  }

  return {
    requestId,
    traceId,
    scope: "PLATFORM",
    platformUser: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status as "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
    },
    platformRole,
    permissions,
    mfaVerified: claims.mfaVerified === true,
    stepUpVerified,
    timestamp: new Date().toISOString(),
  };
}

