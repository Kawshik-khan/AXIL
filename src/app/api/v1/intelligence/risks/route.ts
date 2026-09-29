import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { riskDetectorService } from "@/domains/intelligence/services/risk-detector.service";
import { withStore } from "@/lib/store-unit";

/** Read-only (FX-21): the stored snapshot while fresh, otherwise computed for this request. Never writes. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;
    const { rows, snapshot } = intelligenceSnapshots.read(tenantId, "risks", () => riskDetectorService.computeRisks(tenantId));
    return apiSuccess({ risks: rows, total: rows.length }, { snapshot });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
