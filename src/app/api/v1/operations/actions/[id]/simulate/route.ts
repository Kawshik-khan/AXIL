import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const { product_variant_id, proposed_price } = body;
    const simulation = pricingOperationsService.simulatePriceChange(
      tenantId,
      product_variant_id,
      proposed_price
    );

    return apiSuccess({
      action_id: params.id,
      simulation,
    });
  } catch (err) {
    return apiError(err);
  }
}
