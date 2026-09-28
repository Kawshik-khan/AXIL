import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";
import { db } from "@/infrastructure/db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const customer = await CustomerService.getCustomerById(context, params.id);
    const orders = db.getOrders(context.tenant.id, { customer_id: params.id, limit: 100 });

    return apiSuccess({
      customer,
      addresses: customer.addresses || [],
      orders: orders.orders,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const customer = await CustomerService.updateCustomer(context, params.id, body);
    return apiSuccess({ customer });
  } catch (err) {
    return apiError(err);
  }
}
