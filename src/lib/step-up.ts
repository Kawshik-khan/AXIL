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
import { checkRateLimit } from "@/lib/rate-limit";

export function stepUpEnforced(now = Date.now(), env: NodeJS.ProcessEnv = process.env): boolean {
  const from = Date.parse(env.WORKSPACE_STEP_UP_ENFORCED_FROM ?? "");
  return Number.isFinite(from) && now >= from;
}

const USED_WINDOW_MS = 10 * 60_000; // longer than a token's 5-minute life

/**
 * A step-up token counts only for the action it was issued for, and only once (Stage 1 security review: no 5-minute
 * reuse, neither for another action nor for a second item of the same one). The first use is recorded under the
 * token's id in the shared rate-limit store (Postgres with several servers, in memory otherwise); a second use is
 * refused with STEP_UP_ALREADY_USED, so the client asks for a new code.
 */
async function hasStepUpFor(context: RequestContext, action: string): Promise<boolean> {
  if (context.stepUpVerified !== true || context.stepUpAction !== action || !context.stepUpJti) return false;
  const first = await checkRateLimit(`step-up-jti:${context.stepUpJti}`, 1, USED_WINDOW_MS);
  if (!first.allowed) {
    logger.warn("workspace_step_up.token_reused", { tenant_id: context.tenant.id, user_id: context.user.id, action });
    throw new StepUpRequiredError("That confirmation was already used. Enter a new code from your authenticator app.", action);
  }
  return true;
}

/** Requires a fresh authenticator code (a workspace step-up token) for this request, once enforcement has started. */
export async function requireStepUp(context: RequestContext, action: string): Promise<void> {
  if (await hasStepUpFor(context, action)) return;
  if (!stepUpEnforced()) {
    logger.info("workspace_step_up.not_enforced", { tenant_id: context.tenant.id, user_id: context.user.id, action });
    return;
  }
  const user = db.findUserById(context.user.id);
  if (!user?.mfa_enabled) {
    throw new AppError("MFA_ENROLLMENT_REQUIRED", "Set up an authenticator app (Settings → Security) before doing this.", 403, { action });
  }
  throw new StepUpRequiredError("Enter a code from your authenticator app to confirm this action.", action);
}

/**
 * Step-up with no grace period, for actions that can't be undone (customer erasure, FX-83): always needs a fresh
 * authenticator code, whatever WORKSPACE_STEP_UP_ENFORCED_FROM says.
 */
export async function requireStepUpAlways(context: RequestContext, action: string): Promise<void> {
  if (await hasStepUpFor(context, action)) return;
  const user = db.findUserById(context.user.id);
  if (!user?.mfa_enabled) {
    throw new AppError("MFA_ENROLLMENT_REQUIRED", "Set up an authenticator app (Settings → Security) before doing this.", 403, { action });
  }
  throw new StepUpRequiredError("Enter a code from your authenticator app to confirm this action.", action);
}
