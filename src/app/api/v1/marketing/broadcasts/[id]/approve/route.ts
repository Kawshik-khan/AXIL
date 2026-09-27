import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_APPROVE);
    const campaign = marketingService.approveCampaign(
      context.tenant.id,
      params.id,
      context.user.id // the signed-in approver's id, so the four-eyes check can compare it with the creator
    );

    return apiSuccess({ campaign, message: "Campaign approved successfully for dispatch" });
  } catch (err) {
    return apiError(err);
  }
}
