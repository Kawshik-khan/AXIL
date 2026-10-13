import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Suspends the tenant in the path (HIGH: step-up, ticket; two-person for tenants older than 30 days). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    const suspended = PlatformTenantService.suspendTenant(id, body.reason, context, {
      ticketRef: body.ticket_ref,
      approvalId: body.approval_id,
    });
    return apiSuccess(suspended);
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
