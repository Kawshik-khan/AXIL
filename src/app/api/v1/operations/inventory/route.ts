import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { inventoryOperationsService } from "@/domains/operations/services/inventory-operations.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const inventory = db.getInventory(tenantId);
    const risks = inventoryOperationsService.evaluateStockoutRisks(tenantId);
    const transfers = inventoryOperationsService.evaluateWarehouseTransfers(tenantId);

    return apiSuccess({
      total_items: inventory.length,
      stockout_risks: risks,
      warehouse_transfers: transfers,
      low_stock_count: risks.filter((r) => r.risk_level === "HIGH" || r.risk_level === "CRITICAL").length,
    });
  } catch (err) {
    return apiError(err);
  }
}
