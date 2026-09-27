import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
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

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
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
