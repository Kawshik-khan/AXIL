import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { ForbiddenError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator.") }).strict();

/** Turns the authenticator on (FX-97 Part A) and returns the recovery codes, shown this once. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    if (context.impersonation || context.role === "SERVICE") throw new ForbiddenError("Only the account's owner can set up its authenticator.");
    await enforceRateLimit(`wmfa:confirm:${context.user.id}`, 5, 15 * MINUTE);
    const { code } = parseOrThrow(Body, await readJson(request));
    const response = apiSuccess(WorkspaceMfaService.confirmEnrollment(context.user.id, code));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
