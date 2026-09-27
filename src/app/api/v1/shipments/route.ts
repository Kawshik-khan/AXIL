import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ShippingService } from "@/domains/shipping/shipping.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const order_id = searchParams.get("order_id") || undefined;

    const shipments = await ShippingService.listShipments(context, order_id);
    return apiSuccess({ shipments });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const shipment = await ShippingService.createShipment(context, body);
    return apiSuccess({ shipment }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
