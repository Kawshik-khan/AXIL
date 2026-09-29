import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";

const RejectSchema = z.object({
  reason: z.string().default("Declined by merchant operator"),
});

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_APPROVE);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }
    const validated = RejectSchema.parse(body);

    const campaign = marketingService.rejectCampaign(
      context.tenant.id,
      params.id,
      context.user.id,
      validated.reason
    );

    return apiSuccess({ campaign, message: "Campaign rejected and cancelled" });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
