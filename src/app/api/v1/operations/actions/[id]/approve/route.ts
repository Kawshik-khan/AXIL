import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { procurementService } from "@/domains/operations/services/procurement.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_APPROVE);
    const tenantId = context.tenant.id;
    const actionId = params.id;
    const body = await request.json();

    const { action_type, approved, reason } = body;

    let result: unknown;

    if (action_type === "PRICE_CHANGE") {
      if (approved) {
        result = pricingOperationsService.executePriceChange(tenantId, actionId, context.user.id);
      } else {
        result = { status: "REJECTED", action_id: actionId, reason };
      }
    } else if (action_type === "PURCHASE_ORDER") {
      if (approved) {
        result = procurementService.transitionPurchaseOrderStatus(tenantId, actionId, "APPROVED", context.user.id);
      } else {
        result = procurementService.transitionPurchaseOrderStatus(tenantId, actionId, "CANCELLED", context.user.id);
      }
    } else {
      result = { status: approved ? "APPROVED" : "REJECTED", action_id: actionId, reason };
    }

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
