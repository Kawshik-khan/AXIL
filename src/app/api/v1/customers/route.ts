import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await CustomerService.listCustomers(context, {
      search,
      limit,
      offset,
    });

    return apiSuccess(result.customers, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const customer = await CustomerService.createCustomer(context, body);
    return apiSuccess({ customer }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
