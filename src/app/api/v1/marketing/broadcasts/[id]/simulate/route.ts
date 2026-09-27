import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const simulation = campaignService.simulateCampaign(context.tenant.id, params.id);
    return apiSuccess({ simulation });
  } catch (err) {
    return apiError(err);
  }
}
