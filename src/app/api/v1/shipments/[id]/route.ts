import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { DeliveryStatus } from "@/types/commerce";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

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
