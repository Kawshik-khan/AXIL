import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_APPROVE);
    const { id } = await params;
    // The approver is always the signed-in user; a body field never names someone else (FX-10 step 3).
    const approvedBy = context.user.id;

    const campaign = campaignService.approveCampaign(context.tenant.id, id, approvedBy);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
