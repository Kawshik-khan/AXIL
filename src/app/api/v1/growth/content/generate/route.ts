import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { contentService } from "@/domains/growth/services/content.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();

    const asset = contentService.generateCopyDraft({
      tenantId: context.tenant.id,
      channel: body.channel || "WHATSAPP",
      language: body.language || "banglish",
      customerName: body.customer_name || "Customer",
      productId: body.product_id,
      offerCode: body.offer_code,
      category: body.category || "PROMOTIONAL",
    });

    return apiSuccess({ asset }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
