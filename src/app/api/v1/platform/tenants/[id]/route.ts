import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

type Params = { params: Promise<{ id: string }> };

async function handleGET(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    return apiSuccess(PlatformTenantService.getTenantDetail(id, context));
  } catch (error) {
    return apiError(error);
  }
}

const ArchiveBody = z
  .object({
    reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Archives the tenant in the path (HIGH: step-up and a ticket; two-person for tenants older than 30 days). Data is kept; nothing is hard-deleted here. */
async function handleDELETE(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(ArchiveBody, await readJson(request));
    return apiSuccess(PlatformTenantService.archiveTenant(id, body.reason, context, { ticketRef: body.ticket_ref, approvalId: body.approval_id }));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const DELETE = withStore("DELETE", handleDELETE);
