import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { ForbiddenError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ password: z.string().min(1).max(200) }).strict();

/**
 * Starts authenticator setup for the signed-in workspace user (FX-97 Part A). The password is required again, so a
 * stolen session alone can't bind an attacker's authenticator. The secret is returned once; nothing is on until
 * /auth/mfa/confirm.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    if (context.impersonation || context.role === "SERVICE") throw new ForbiddenError("Only the account's owner can set up its authenticator.");
    await enforceRateLimit(`wmfa:enroll:${context.user.id}`, 5, 15 * MINUTE);
    const { password } = parseOrThrow(Body, await readJson(request));
    const enrollment = await WorkspaceMfaService.startEnrollment(context.user.id, password);
    const response = apiSuccess(enrollment);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
