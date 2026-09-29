import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const priceRequests = db.getPriceChangeRequests(tenantId);
    const purchaseOrders = db.getPurchaseOrders(tenantId);
    const receipts = db.getActionReceipts(tenantId);

    return apiSuccess({
      pending_price_changes: priceRequests.filter((r) => r.status === "PENDING_APPROVAL"),
      pending_purchase_orders: purchaseOrders.filter((po) => po.status === "PENDING_APPROVAL"),
      recent_receipts: receipts.slice(0, 50),
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
