import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { InventoryService } from "@/domains/inventory/inventory.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const updatedItem = await InventoryService.adjustStock(context, body);
    return apiSuccess({ item: updatedItem });
  } catch (err) {
    return apiError(err);
  }
}
