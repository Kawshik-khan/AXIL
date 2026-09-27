import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status") || undefined;
    const payment_status = searchParams.get("payment_status") || undefined;
    const customer_id = searchParams.get("customer_id") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await OrderService.listOrders(context, {
      status,
      payment_status,
      customer_id,
      search,
      limit,
      offset,
    });

    return apiSuccess(result.orders, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const order = await OrderService.createOrder(context, body);
    return apiSuccess({ order }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
