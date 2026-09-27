import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { contentService } from "@/domains/growth/services/content.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();

    const verification = contentService.verifyContentFactuality({
      tenantId: context.tenant.id,
      text: body.text,
      productId: body.product_id,
      offerCode: body.offer_code,
    });

    return apiSuccess({ verification });
  } catch (err) {
    return apiError(err);
  }
}
