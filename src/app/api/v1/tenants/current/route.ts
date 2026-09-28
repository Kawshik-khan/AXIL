import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { TenantService } from "@/domains/tenants/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { PricingService } from "@/domains/pricing/pricing.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.WORKSPACE_READ);

    const tenant = TenantService.getTenantById(context.tenant.id);
    // The fees orders are actually charged (settings, or the defaults in code), so forms never print their own
    return apiSuccess({ tenant, delivery_fees: PricingService.getDeliveryFees(context.tenant.id) });
  } catch (err) {
    return apiError(err);
  }
}
