import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";
import { db } from "@/infrastructure/db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const order = await OrderService.getOrderById(context, params.id);
    const payments = db.getPayments(context.tenant.id, params.id);
    const shipments = db.getShipments(context.tenant.id, params.id);
    const timeline = db.getEvents(context.tenant.id, 100).filter(
      (e) => e.aggregate_id === params.id || e.correlation_id === order.order_number
    );

    return apiSuccess({
      order,
      payments,
      shipments,
      timeline,
    });
  } catch (err) {
    return apiError(err);
  }
}
