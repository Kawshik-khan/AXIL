import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { BadRequestError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const idempotencyKey =
      request.headers.get("idempotency-key") ||
      request.headers.get("x-idempotency-key");

    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is strictly required for automated stock adjustments.");
    }

    const body = await request.json();

    const { data, isCached } = await IdempotencyService.executeIdempotent(
      context.tenant.id,
      idempotencyKey,
      "AUTOMATION_INVENTORY_ADJUST",
      body,
      async () => {
        const item = await InventoryService.adjustStock(context, {
          warehouse_id: body.warehouse_id,
          product_variant_id: body.product_variant_id,
          quantity_delta: body.quantity_delta,
          type: body.type || "AUDIT",
          reason: body.reason || "Automated adjustment via n8n",
          reference_type: "automation",
          reference_id: idempotencyKey,
        });
        return { item, verified: true };
      }
    );

    return apiSuccess(data, { is_cached: isCached });
  } catch (err) {
    return apiError(err);
  }
}
