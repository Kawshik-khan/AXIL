import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";
import { withStore } from "@/lib/store-unit";

/** Order counts by status across every order of this workspace (tenant from the session). Read-only. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(await OrderService.getStatusCounts(context));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
