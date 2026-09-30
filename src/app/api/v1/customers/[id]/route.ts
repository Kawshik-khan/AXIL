import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
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

async function handlePATCH(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const customer = await CustomerService.updateCustomer(context, params.id, body);
    return apiSuccess({ customer });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
