import { z } from "zod";
import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

const Body = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

/** Completes TOTP setup: MFA turns on only after the authenticator produced a valid code (FX-15). */
export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    enforceRateLimit(`mfa:confirm:${context.platformUser.id}`, 5, 15 * MINUTE);
    const { code } = parseOrThrow(Body, await readJson(request));
    PlatformMfaService.confirmEnrollment(context.platformUser.id, code);
    return apiSuccess({ mfa_enabled: true });
  } catch (error) {
    return apiError(error);
  }
}
