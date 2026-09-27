import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const body = await request.json();

    if (!body.scheduled_start_at) {
      return apiError(new Error("scheduled_start_at is required"));
    }

    const campaign = campaignService.scheduleCampaign(context.tenant.id, id, body.scheduled_start_at);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}
