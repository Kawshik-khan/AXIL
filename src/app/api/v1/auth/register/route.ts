import { z } from "zod";
import { AuthService } from "@/domains/auth/service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";
import { enforceRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { isAppError, ValidationError } from "@/lib/errors";

/** A required string whose every error names the field, so the sign-up page can point at it. */
const requiredText = (message: string) => z.string({ required_error: message, invalid_type_error: message }).trim();

// Strict (ADR-104): tenant_id, role, status and any other unknown key are rejected, never ignored.
const RegisterBody = z
  .object({
    name: requiredText("Your full name must be at least 2 characters.")
      .min(2, "Your full name must be at least 2 characters.")
      .max(80, "Your full name must be at most 80 characters."),
    workspaceName: requiredText("Workspace name must be at least 2 characters.")
      .min(2, "Workspace name must be at least 2 characters.")
      .max(80, "Workspace name must be at most 80 characters."),
    email: requiredText("Valid email address is required.")
      .max(254, "Valid email address is required.")
      .email("Valid email address is required."),
    password: z
      .string({ required_error: "Password must be at least 8 characters long.", invalid_type_error: "Password must be at least 8 characters long." })
      .min(8, "Password must be at least 8 characters long.")
      .max(200, "Password must be at most 200 characters long."),
    currency: z.enum(["BDT", "USD", "EUR"], { errorMap: () => ({ message: "Currency must be BDT, USD or EUR." }) }).optional(),
  })
  .strict();

/** parseOrThrow, but the message is the first issue's (it names the field); every issue stays in the details. */
function parseRegisterBody(input: unknown): z.infer<typeof RegisterBody> {
  try {
    return parseOrThrow(RegisterBody, input);
  } catch (err) {
    const first = isAppError(err) ? (err.details?.issues as { message: string }[] | undefined)?.[0] : undefined;
    if (isAppError(err) && first) throw new ValidationError(first.message, err.details);
    throw err;
  }
}

async function handlePOST(request: Request) {
  try {
    // Sign-up limits (FX-14): 5 per client per hour behind a trusted proxy, and a global cap of 30 per hour.
    const client = clientKey(request);
    if (client) await enforceRateLimit(`register:client:${client}`, 5, 60 * MINUTE);
    await enforceRateLimit("register:global", 30, 60 * MINUTE); // always, so no header can lift the overall cap
    const body = parseRegisterBody(await readJson(request));
    const result = await AuthService.registerTenantWithOwner(body);

    const response = apiSuccess(
      {
        user: result.user,
        tenant: result.tenant,
        role: result.role,
      },
      undefined,
      201
    );

    // Set secure HttpOnly session cookie
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
