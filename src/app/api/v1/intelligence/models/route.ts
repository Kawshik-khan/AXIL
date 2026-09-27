import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { modelRegistryService } from "@/domains/intelligence/services/model-registry.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const models = modelRegistryService.listModels();
    return apiSuccess({ models, total: models.length });
  } catch (err) {
    return apiError(err);
  }
}
