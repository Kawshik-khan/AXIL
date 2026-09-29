import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { AttributionModel } from "@/types/growth";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const url = new URL(request.url);
    const model = (url.searchParams.get("model") || "LAST_TOUCH") as AttributionModel;

    const report = marketingService.getAttributionReport(context.tenant.id, model);
    return apiSuccess(report);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
