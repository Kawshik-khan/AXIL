import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseOperationsService } from "@/domains/enterprise/services/enterprise-operations.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const overview = enterpriseOperationsService.getOverview(orgId, context.tenant.id);
    return apiSuccess(overview);
  } catch (err) {
    return apiError(err);
  }
}
