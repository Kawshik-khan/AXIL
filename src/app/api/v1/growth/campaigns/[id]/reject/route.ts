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
    RbacService.assertCan(context, PERMISSIONS.MARKETING_APPROVE);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const rejectedBy = context.user.id; // the signed-in user, never a body field (FX-10 step 3)
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "Rejected by merchant";

    const campaign = campaignService.rejectCampaign(context.tenant.id, id, rejectedBy, reason);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}
