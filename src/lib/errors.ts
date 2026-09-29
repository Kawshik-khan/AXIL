/**
 * Marks AppErrors across bundle copies: Next compiles instrumentation (which creates the store) separately from the
 * routes, so an error the store throws is an AppError from another copy of this module and `instanceof` misses it
 * (a 409 conflict answered as a 500). `Symbol.for` is shared by every copy.
 */
const APP_ERROR = Symbol.for("commerceos.AppError");

/** True for an AppError from any copy of this module. */
export function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[APP_ERROR] === true;
}

export class AppError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Object.defineProperty(this, APP_ERROR, { value: true });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * An external integration isn't connected or not implemented, so nothing was sent (FX-31, non-negotiable 7).
 * Not retryable: trying again can't succeed until the integration exists.
 */
export class IntegrationNotConfiguredError extends AppError {
  readonly retryable = false;
  constructor(integration: string, detail?: string) {
    super("INTEGRATION_NOT_CONFIGURED", `${integration} is not connected${detail ? ` (${detail})` : ""}. Nothing was sent.`, 424, { integration });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required or credentials invalid.", details?: Record<string, unknown>) {
    super("AUTHENTICATION_FAILED", message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not possess the required permission for this operation.", details?: Record<string, unknown>) {
    super("FORBIDDEN", message, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const msg = identifier ? `${resource} '${identifier}' was not found.` : `${resource} was not found.`;
    super("NOT_FOUND", msg, 404, { resource, identifier });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("BAD_REQUEST", message, 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, 409, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class TenantSuspendedError extends AppError {
  constructor(tenantName?: string) {
    super("TENANT_SUSPENDED", `Workspace ${tenantName || ""} is currently suspended. Please contact support.`, 403);
  }
}

export class UserSuspendedError extends AppError {
  constructor() {
    super("USER_SUSPENDED", "Your user account is currently suspended or deactivated.", 403);
  }
}

// Platform Control Plane Structured Errors (Section 65)
export class PlatformAuthRequiredError extends AppError {
  constructor(message = "Platform operator authentication required.") {
    super("PLATFORM_AUTH_REQUIRED", message, 401);
  }
}

export class PlatformPermissionDeniedError extends AppError {
  constructor(permission: string, role?: string) {
    super(
      "PLATFORM_PERMISSION_DENIED",
      `Operation requires platform permission '${permission}', which is not granted to role '${role || "unassigned"}'.`,
      403,
      { permission, role }
    );
  }
}

export class PlatformScopeRequiredError extends AppError {
  constructor(message = "Operation requires PLATFORM scope. Tenant credentials cannot access platform control plane.") {
    super("PLATFORM_SCOPE_REQUIRED", message, 403);
  }
}

export class TenantStateInvalidError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("TENANT_STATE_INVALID", message, 400, details);
  }
}

export class StepUpRequiredError extends AppError {
  constructor(message = "This privileged operation requires step-up authentication (MFA/WebAuthn).") {
    super("STEP_UP_REQUIRED", message, 403);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message = "This critical action requires dual-custodian policy approval before execution.") {
    super("APPROVAL_REQUIRED", message, 403);
  }
}

export class ImpersonationNotAllowedError extends AppError {
  constructor(message = "Support impersonation is not permitted for this tenant or target account.") {
    super("IMPERSONATION_NOT_ALLOWED", message, 403);
  }
}

export class ImpersonationExpiredError extends AppError {
  constructor(message = "The support impersonation session has expired or been revoked.") {
    super("IMPERSONATION_EXPIRED", message, 401);
  }
}

export class FeatureNotEntitledError extends AppError {
  constructor(entitlement: string, plan?: string) {
    super(
      "FEATURE_NOT_ENTITLED",
      `Workspace is not entitled to use '${entitlement}' under current plan '${plan || "active"}'.`,
      403,
      { entitlement, plan }
    );
  }
}

/** A plan limit on things that exist now (users, products, channels) would be exceeded (FX-34). */
export class PlanLimitError extends AppError {
  constructor(resource: string, limit: number, current: number) {
    super("PLAN_LIMIT_REACHED", `Your plan allows ${limit} ${resource.replace(/^max_/, "")}; you have ${current}. Upgrade or remove some first.`, 403, {
      resource,
      limit,
      current,
    });
  }
}

export class QuotaExceededError extends AppError {
  constructor(resource: string, limit: number, current: number) {
    super(
      "QUOTA_EXCEEDED",
      `Monthly quota for '${resource}' exceeded: ${current}/${limit}.`,
      429,
      { resource, limit, current }
    );
  }
}

export class KillSwitchActiveError extends AppError {
  constructor(scope: string, reason?: string) {
    super(
      "KILL_SWITCH_ACTIVE",
      `Operation blocked: Emergency kill switch is ACTIVE for scope '${scope}'. Reason: ${reason || "Emergency incident containment"}.`,
      503,
      { scope, reason }
    );
  }
}

export class MaintenanceActiveError extends AppError {
  constructor(message = "Platform is currently undergoing scheduled maintenance.") {
    super("MAINTENANCE_ACTIVE", message, 503);
  }
}

export class ConcurrentModificationError extends AppError {
  constructor(message = "Concurrent modification detected. Please refresh and retry.") {
    super("CONCURRENT_MODIFICATION", message, 409);
  }
}


/** The user's access to this workspace was suspended by a workspace admin (their account itself is unaffected). */
export class MembershipSuspendedError extends AppError {
  constructor() {
    super("MEMBERSHIP_SUSPENDED", "Your access to this workspace has been suspended. Contact a workspace admin.", 403);
  }
}
