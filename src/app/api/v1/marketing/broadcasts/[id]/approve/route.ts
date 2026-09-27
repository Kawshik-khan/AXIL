import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const campaign = marketingService.approveCampaign(
      context.tenant.id,
      params.id,
      context.user?.name || "Merchant Owner"
    );

    return apiSuccess({ campaign, message: "Campaign approved successfully for dispatch" });
  } catch (err) {
    return apiError(err);
  }
}
