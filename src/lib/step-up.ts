/**
 * Step-up for privileged workspace actions (AI fix plan FX-97 Part A).
 *
 * Enforcement starts on the date in WORKSPACE_STEP_UP_ENFORCED_FROM (platform environment, ISO date), so owners and
 * admins get time to set up an authenticator first. Before that date, or with the variable unset, a missing step-up is
 * logged and allowed; from that date it's refused with 403 STEP_UP_REQUIRED (or MFA_ENROLLMENT_REQUIRED when the user
 * has no authenticator yet).
 */
import type { RequestContext } from "@/lib/context";
import { AppError, StepUpRequiredError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/infrastructure/db";

export function stepUpEnforced(now = Date.now(), env: NodeJS.ProcessEnv = process.env): boolean {
  const from = Date.parse(env.WORKSPACE_STEP_UP_ENFORCED_FROM ?? "");
  return Number.isFinite(from) && now >= from;
}

/** Requires a fresh authenticator code (a workspace step-up token) for this request, once enforcement has started. */
export function requireStepUp(context: RequestContext, action: string): void {
  if (context.stepUpVerified) return;
  if (!stepUpEnforced()) {
    logger.info("workspace_step_up.not_enforced", { tenant_id: context.tenant.id, user_id: context.user.id, action });
    return;
  }
  const user = db.findUserById(context.user.id);
  if (!user?.mfa_enabled) {
    throw new AppError("MFA_ENROLLMENT_REQUIRED", "Set up an authenticator app (Settings → Security) before doing this.", 403, { action });
  }
  throw new StepUpRequiredError("Enter a code from your authenticator app to confirm this action.");
}

/**
 * Step-up with no grace period, for actions that can't be undone (customer erasure, FX-83): always needs a fresh
 * authenticator code, whatever WORKSPACE_STEP_UP_ENFORCED_FROM says.
 */
export function requireStepUpAlways(context: RequestContext, action: string): void {
  if (context.stepUpVerified) return;
  const user = db.findUserById(context.user.id);
  if (!user?.mfa_enabled) {
    throw new AppError("MFA_ENROLLMENT_REQUIRED", "Set up an authenticator app (Settings → Security) before doing this.", 403, { action });
  }
  throw new StepUpRequiredError("Enter a code from your authenticator app to confirm this action.");
}
