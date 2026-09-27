import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const members = marketingService.getAudienceMembers(context.tenant.id, params.id);
    return apiSuccess({ members, total: members.length });
  } catch (err) {
    return apiError(err);
  }
}
