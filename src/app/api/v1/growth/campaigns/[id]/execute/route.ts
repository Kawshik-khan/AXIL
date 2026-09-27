import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const result = await campaignService.executeCampaign(context.tenant.id, id);
    return apiSuccess({ result });
  } catch (err) {
    return apiError(err);
  }
}
