import { z } from "zod";
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

const CreateShipmentBody = z
  .object({
    order_id: z.string().min(1),
    courier_provider: z.enum(["PATHAO", "STEADFAST", "REDX", "PAPERFLY", "MANUAL"]),
    tracking_number: z.string().trim().min(1, "Enter the courier's tracking number"),
    consignment_id: z.string().trim().optional(),
    shipping_cost: z.number().nonnegative().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    // Strict body (Phase 3 security review F2): a non-string tracking number used to crash with a 500
    const body = CreateShipmentBody.parse(await request.json());

    const shipment = await ShippingService.createShipment(context, body);
    return apiSuccess({ shipment }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
