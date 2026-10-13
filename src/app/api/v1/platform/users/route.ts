import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformUserService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/** Platform operators (role, MFA, active). Tenant staff: /api/v1/platform/tenants/[id] (detail). */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformUserService.listPlatformUsers(context));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z
  .object({
    userId: z.string().trim().min(1).max(100),
    role: z.enum(["SUPER_ADMIN", "PLATFORM_ADMIN", "PLATFORM_OPERATIONS", "PLATFORM_SUPPORT", "PLATFORM_FINANCE", "PLATFORM_SECURITY", "PLATFORM_ANALYST"]),
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Assigns a platform role (CRITICAL: step-up, ticket, second operator; never your own role). */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(
      PlatformUserService.assignPlatformRole(
        { userId: body.userId, role: body.role, reason: body.reason, ticketRef: body.ticket_ref, approvalId: body.approval_id },
        context
      )
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
