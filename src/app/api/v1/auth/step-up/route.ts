import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { AppError, ForbiddenError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    // A 6-digit authenticator code, or one of the recovery codes (XXXXX-XXXXX)
    code: z.string().trim().min(6).max(20),
    action: z.string().regex(/^[A-Z0-9_]{1,60}$/).optional(),
  })
  .strict();

/**
 * Workspace step-up (FX-97 Part A): a fresh authenticator code (or a recovery code) buys a 5-minute token that the
 * dashboard sends as `x-step-up-token` with a privileged request. Bound to this user and their current session.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    if (context.impersonation || context.role === "SERVICE") throw new ForbiddenError("Step-up is for the signed-in account's owner.");
    await enforceRateLimit(`wmfa:step-up:${context.user.id}`, 5, 15 * MINUTE);
    if (!WorkspaceMfaService.isEnrolled(context.user.id)) {
      throw new AppError("MFA_NOT_ENROLLED", "Set up an authenticator app before using step-up.", 409);
    }
    const { code, action } = parseOrThrow(Body, await readJson(request));
    if (!WorkspaceMfaService.verifyCode(context.user.id, code)) {
      logger.warn("workspace.step_up_failed", { tenant_id: context.tenant.id, user_id: context.user.id });
      throw new AppError("INVALID_MFA_CODE", "The code is not valid.", 400);
    }
    const stepUpToken = await WorkspaceMfaService.issueStepUpToken(context.user.id, action);
    logger.info("workspace.step_up_granted", { tenant_id: context.tenant.id, user_id: context.user.id, action: action ?? "PRIVILEGED_ACTION" });
    const response = apiSuccess({ stepUpToken, expires_in: 300 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
