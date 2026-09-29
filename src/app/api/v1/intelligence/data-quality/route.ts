import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { dataQualityService } from "@/domains/intelligence/services/data-quality.service";
import { withStore } from "@/lib/store-unit";

/** Read-only (FX-21): today's stored report while fresh, otherwise computed for this request. Never writes. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;
    const { rows, snapshot } = intelligenceSnapshots.read(tenantId, "data_quality", () => [
      dataQualityService.computeDataQualityReport(tenantId),
    ]);
    return apiSuccess({ report: rows[0] ?? dataQualityService.computeDataQualityReport(tenantId) }, { snapshot });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
