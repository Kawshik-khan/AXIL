import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";
import { OrderStatus } from "@/types/commerce";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const targetStatus: OrderStatus = body.status;
    const reason: string = body.reason;

    const updated = await OrderService.transitionOrderStatus(
      context,
      params.id,
      targetStatus,
      reason
    );

    return apiSuccess({ order: updated });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
