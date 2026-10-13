import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

type Params = { params: Promise<{ id: string }> };

const ScheduleBody = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
    confirmation: z.string().max(200).optional(),
  })
  .strict();

/**
 * Schedules a purge of the tenant in the path (CRITICAL: two-person approval, typed CONFIRM_PURGE_<SLUG>).
 * The tenant is archived and its data kept for the tombstone period; the response states that nothing was deleted.
 * Replaces POST /api/v1/platform/compliance/purge, which reported a purge that never happened (SA-16).
 */
async function handlePOST(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(ScheduleBody, await readJson(request));
    return apiSuccess(
      PlatformTenantService.schedulePurge(
        id,
        { reason: body.reason, ticketRef: body.ticket_ref, approvalId: body.approval_id, confirmation: body.confirmation },
        context
      )
    );
  } catch (error) {
    return apiError(error);
  }
}

const CancelBody = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Cancels a scheduled purge during the tombstone period (HIGH). */
async function handleDELETE(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(CancelBody, await readJson(request));
    return apiSuccess(PlatformTenantService.cancelPurge(id, { reason: body.reason, ticketRef: body.ticket_ref }, context));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
export const DELETE = withStore("DELETE", handleDELETE);
