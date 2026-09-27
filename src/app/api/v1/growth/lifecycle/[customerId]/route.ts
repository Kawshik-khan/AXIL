import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { customerId } = await params;
    const lifecycle = customerLifecycleService.evaluateCustomerLifecycle(context.tenant.id, customerId);
    return apiSuccess({ lifecycle });
  } catch (err) {
    return apiError(err);
  }
}
