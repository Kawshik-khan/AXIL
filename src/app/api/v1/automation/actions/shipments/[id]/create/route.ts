import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const idempotencyKey =
      request.headers.get("idempotency-key") ||
      request.headers.get("x-idempotency-key");

    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is strictly required for automated shipment creation.");
    }

    const body = await request.json().catch(() => ({}));
    const orderId = params.id;

    const { data, isCached } = await IdempotencyService.executeIdempotent(
      context.tenant.id,
      idempotencyKey,
      `AUTOMATION_SHIPMENT_CREATE_${orderId}`,
      body,
      async () => {
        const shipment = await ShippingService.createShipment(context, {
          order_id: orderId,
          courier_provider: body.courier_provider || "STEADFAST",
          tracking_number: body.tracking_number,
          shipping_cost: body.shipping_cost,
          consignment_id: body.consignment_id,
        });
        return { shipment, verified: true };
      }
    );

    return apiSuccess(data, { is_cached: isCached }, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
