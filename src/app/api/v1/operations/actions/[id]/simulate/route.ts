import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { withStore } from "@/lib/store-unit";
import { OPERATIONS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
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

export const POST = withStore("POST", handlePOST, { tenantRows: { collections: OPERATIONS_COLLECTIONS, permission: PERMISSIONS.OPERATIONS_READ } });
