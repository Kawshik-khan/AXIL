import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const warehouses = await InventoryService.listWarehouses(context);
    return apiSuccess({ warehouses });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const warehouse = await InventoryService.createWarehouse(context, body);
    return apiSuccess({ warehouse }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
