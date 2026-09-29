import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const warehouse_id = searchParams.get("warehouse_id") || undefined;
    const low_stock_only = searchParams.get("low_stock_only") === "true";

    const inventory = await InventoryService.getInventoryLevels(context, {
      warehouse_id,
      low_stock_only,
    });

    return apiSuccess({ inventory });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
