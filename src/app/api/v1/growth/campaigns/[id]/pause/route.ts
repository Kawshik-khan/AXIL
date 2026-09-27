import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const campaign = campaignService.pauseCampaign(context.tenant.id, id);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}
