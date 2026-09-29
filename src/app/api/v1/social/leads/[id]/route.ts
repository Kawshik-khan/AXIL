import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { LeadService } from "@/domains/social/leads/lead.service";
import { withStore } from "@/lib/store-unit";

const LeadPatch = z
  .object({
    status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]),
    notes: z.string().max(5000).optional(),
  })
  .strict();

async function handleGET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const lead = await LeadService.getLeadById(context, params.id);
    return apiSuccess({ lead });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(LeadPatch, await readJson(request));

    const updated = await LeadService.updateStatus(context, params.id, body.status, body.notes);
    return apiSuccess({ lead: updated });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
