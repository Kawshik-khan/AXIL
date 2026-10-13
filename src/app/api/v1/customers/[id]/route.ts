import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";
import { orderRepository } from "@/domains/orders/order.repository";
import { withStore } from "@/lib/store-unit";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const customer = await CustomerService.getCustomerById(context, params.id);
    // Order history needs orders.read too: a role that may see customers but not orders (MARKETING) gets none, as
    // null (not shown), never an empty list that would read as "no orders"
    const orders = RbacService.can(context, PERMISSIONS.ORDERS_READ)
      ? (await orderRepository.listOrders(context.tenant.id, { customer_id: params.id, limit: 100 })).orders
      : null;

    return apiSuccess({
      customer,
      addresses: customer.addresses || [],
      orders,
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
