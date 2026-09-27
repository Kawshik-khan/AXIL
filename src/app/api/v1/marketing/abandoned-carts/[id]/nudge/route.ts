import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

const NudgeSchema = z.object({
  custom_offer_code: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }
    const validated = NudgeSchema.parse(body);

    const result = await marketingService.sendWhatsAppRecoveryNudge({
      tenantId: context.tenant.id,
      cartId: params.id,
      customOfferCode: validated.custom_offer_code,
    });

    return apiSuccess({ result });
  } catch (err) {
    return apiError(err);
  }
}
