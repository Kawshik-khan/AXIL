import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { InventoryService } from "@/domains/inventory/inventory.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const warehouses = await InventoryService.listWarehouses(context);
    return apiSuccess({ warehouses });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const warehouse = await InventoryService.createWarehouse(context, body);
    return apiSuccess({ warehouse }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
