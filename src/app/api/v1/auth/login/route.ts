import { z } from "zod";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";
import { enforceRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { isAppError, ValidationError } from "@/lib/errors";

// Strict (ADR-104): tenant_id, role and any other unknown key are rejected, never ignored. The password is not
// trimmed; a wrong one still gets the generic credential error from AuthService.login.
const LoginBody = z
  .object({
    email: z
      .string({ required_error: "Email is required.", invalid_type_error: "Email is required." })
      .trim()
      .min(1, "Email is required.")
      .max(254, "Email must be at most 254 characters."),
    password: z
      .string({ required_error: "Password is required.", invalid_type_error: "Password is required." })
      .min(1, "Password is required.")
      .max(200, "Password must be at most 200 characters."),
    tenantId: z.string({ invalid_type_error: "tenantId must be a string." }).max(100).optional(),
  })
  .strict();

/** parseOrThrow, but the message is the first issue's (it names the field); every issue stays in the details. */
function parseLoginBody(input: unknown): z.infer<typeof LoginBody> {
  try {
    return parseOrThrow(LoginBody, input);
  } catch (err) {
    const first = isAppError(err) ? (err.details?.issues as { message: string }[] | undefined)?.[0] : undefined;
    if (isAppError(err) && first) throw new ValidationError(first.message, err.details);
    throw err;
  }
}

async function handlePOST(request: Request) {
  try {
    const body = parseLoginBody(await readJson(request));
    // Brute-force limits (FX-14): per account always, per client when a trusted proxy identifies it.
    const email = body.email.toLowerCase();
    await enforceRateLimit(`login:tenant:email:${email}`, 10, 15 * MINUTE);
    const client = clientKey(request);
    if (client) await enforceRateLimit(`login:tenant:client:${client}`, 50, 15 * MINUTE);
    const result = await AuthService.login(body.email, body.password, body.tenantId);

    const platformMembership = (await import("@/infrastructure/db")).db.findPlatformMembershipByUserId(result.user.id);

    const response = apiSuccess({
      user: result.user,
      tenant: result.tenant,
      role: result.role,
      isPlatformUser: !!(platformMembership && platformMembership.is_active),
      platformRole: platformMembership?.is_active ? platformMembership.role : undefined,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    // Platform operators sign in to the control plane separately at /super-admin/login, where TOTP applies. The
    // workspace login no longer issues a platform session (it bypassed the operator MFA step, FX-15).

    return response;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
