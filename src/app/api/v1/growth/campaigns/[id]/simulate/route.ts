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
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const { id } = await params;
    const snapshot = campaignService.simulateCampaign(context.tenant.id, id);
    return apiSuccess({ simulation: snapshot });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
