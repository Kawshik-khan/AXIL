import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataGovernanceService } from "@/domains/enterprise/services/data-governance.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    let assets = db.getDataAssets(orgId);
    if (assets.length === 0) {
      assets = dataGovernanceService.seedDefaultAssets(orgId);
    }

    return apiSuccess({
      total_assets: assets.length,
      assets,
      retention_compliant: true,
      encryption_at_rest: true,
    });
  } catch (err) {
    return apiError(err);
  }
}
