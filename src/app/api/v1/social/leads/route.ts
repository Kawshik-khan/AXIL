import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { LeadService } from "@/domains/social/leads/lead.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status") || undefined;
    const assigned_to = searchParams.get("assigned_to") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await LeadService.listLeads(context, { status, assigned_to, limit, offset });
    return apiSuccess(result.leads, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const lead = await LeadService.createLead(context, body);
    return apiSuccess({ lead }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
