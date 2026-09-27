import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { journeyEngineService } from "@/domains/growth/services/journey-engine.service";

export async function POST(
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
