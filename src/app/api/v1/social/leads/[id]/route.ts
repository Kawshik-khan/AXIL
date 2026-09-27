import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { LeadService } from "@/domains/social/leads/lead.service";

export async function GET(
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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const updated = await LeadService.updateStatus(context, params.id, body.status, body.notes);
    return apiSuccess({ lead: updated });
  } catch (err) {
    return apiError(err);
  }
}
