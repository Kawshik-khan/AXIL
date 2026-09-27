import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { DeliveryStatus } from "@/types/commerce";

const ShipmentPatch = z
  .object({
    status: z.enum(["PENDING", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "RETURNED", "CANCELLED"]),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(ShipmentPatch, await readJson(request));

    const targetStatus: DeliveryStatus = body.status;
    const updated = await ShippingService.updateDeliveryStatus(
      context,
      params.id,
      targetStatus
    );

    return apiSuccess({ shipment: updated });
  } catch (err) {
    return apiError(err);
  }
}
