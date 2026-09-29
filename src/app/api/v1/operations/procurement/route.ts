import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PROCUREMENT_READ);
    const tenantId = context.tenant.id;

    const purchaseOrders = db.getPurchaseOrders(tenantId);
    const suppliers = db.getSuppliers(tenantId);
    const recommendations = procurementService.generateReplenishmentRecommendations(tenantId);

    return apiSuccess({
      purchase_orders_count: purchaseOrders.length,
      suppliers_count: suppliers.length,
      purchase_orders: purchaseOrders,
      suppliers,
      restock_recommendations: recommendations,
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PROCUREMENT_MANAGE);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const po = procurementService.createPurchaseOrderDraft(tenantId, {
      supplierId: body.supplier_id,
      items: body.items,
      notes: body.notes,
    });

    return apiSuccess(po);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
