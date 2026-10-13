import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { journeyEngineService } from "@/domains/growth/services/journey-engine.service";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const journey = journeyEngineService.resumeJourney(context.tenant.id, id);
    return apiSuccess({ journey });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.MARKETING_WRITE } });
