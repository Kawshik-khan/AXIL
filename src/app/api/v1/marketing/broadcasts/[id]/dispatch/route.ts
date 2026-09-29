import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const result = await marketingService.dispatchBroadcast(context.tenant.id, params.id);
    return apiSuccess({ result });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
