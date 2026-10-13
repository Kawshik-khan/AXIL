import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { fulfillmentOperationsService } from "@/domains/operations/services/fulfillment-operations.service";
import { orderRepository } from "@/domains/orders/order.repository";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS, loadTenantRows } from "@/infrastructure/db/tenant-rows";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const readyOrders = await orderRepository.findUnfulfilledOrders(tenantId);
    await loadTenantRows(tenantId, COMMERCE_ANALYTICS_COLLECTIONS); // zero-hydration: what the plans read (read-only)

    const candidatePlans = readyOrders.slice(0, 10).map((o) => {
      try {
        return fulfillmentOperationsService.planFulfillment(tenantId, o.id);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return apiSuccess({
      ready_orders_count: readyOrders.length,
      candidate_plans: candidatePlans,
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_EXECUTE);
    const tenantId = context.tenant.id;
    const body = await request.json();

    await loadTenantRows(tenantId, COMMERCE_ANALYTICS_COLLECTIONS); // zero-hydration: what the plan reads
    const plan = fulfillmentOperationsService.planFulfillment(tenantId, body.order_id);
    return apiSuccess(plan);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
