import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataLineageService } from "@/domains/enterprise/services/data-lineage.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DATA_LINEAGE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";
    const assetName = searchParams.get("asset_name") || "orders";

    const lineage = dataLineageService.getProvenance(orgId, assetName);
    return apiSuccess({
      asset_name: assetName,
      total_traces: lineage.length,
      traces: lineage,
    });
  } catch (err) {
    return apiError(err);
  }
}
