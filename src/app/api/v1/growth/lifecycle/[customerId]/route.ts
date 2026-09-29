import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const { customerId } = await params;
    const lifecycle = customerLifecycleService.previewCustomerLifecycle(context.tenant.id, customerId); // read-only (FX-21)
    return apiSuccess({ lifecycle });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
