import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const rejectedBy = body.rejected_by || context.user?.id || "MERCHANT";
    const reason = body.reason || "Rejected by merchant";

    const campaign = campaignService.rejectCampaign(context.tenant.id, id, rejectedBy, reason);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}
