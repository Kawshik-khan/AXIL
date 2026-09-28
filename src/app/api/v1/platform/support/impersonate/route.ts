import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { impersonationCookie } from "@/lib/impersonation";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { db } from "@/infrastructure/db";
import { PlatformSupportService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const sessions = PlatformSupportService.listSessions(context);
    return apiSuccess(sessions);
  } catch (error) {
    return apiError(error);
  }
}

const StartBody = z
  .object({
    tenant_id: z.string().min(1),
    /** Defaults to the workspace owner. */
    user_id: z.string().min(1).optional(),
    reason: z.string().trim().min(10).max(500),
    ticket_id: z.string().trim().max(100).optional(),
    mode: z.enum(["READ_ONLY", "MUTATION_APPROVED"]).default("READ_ONLY"),
    duration_minutes: z.number().int().min(5).max(120).default(30),
  })
  .strict();

/**
 * Starts a support session and sets the impersonation cookie (FX-34 step 5). The token used to be returned in the
 * body (and shown in an alert), and nothing accepted it; the console also sent field names the service didn't read.
 */
export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "support.impersonate"); // before any lookup (no existence probing)
    const body = StartBody.parse(await request.json());
    const targetUserId =
      body.user_id ?? db.findMembershipsByTenantId(body.tenant_id).find((m) => m.role === "OWNER" && m.status !== "SUSPENDED")?.user_id;
    if (!targetUserId) throw new NotFoundError("Owner of workspace", body.tenant_id);
    const { session, token } = await PlatformSupportService.startImpersonationSession(
      {
        targetTenantId: body.tenant_id,
        targetUserId,
        reason: body.reason,
        ticketReference: body.ticket_id,
        mode: body.mode,
        durationMinutes: body.duration_minutes,
      },
      context
    );
    const response = apiSuccess({ session }, undefined, 201);
    const maxAge = Math.max(1, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000));
    response.cookies.set(impersonationCookie(token, maxAge));
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const reason = searchParams.get("reason") || "Revoked by operator";

    if (!sessionId) {
      throw new ValidationError("sessionId parameter is required");
    }

    const session = PlatformSupportService.revokeSession(sessionId, reason, context);
    return apiSuccess(session);
  } catch (error) {
    return apiError(error);
  }
}
