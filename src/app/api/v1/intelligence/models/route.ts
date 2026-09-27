import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { modelRegistryService } from "@/domains/intelligence/services/model-registry.service";

export async function GET(request: Request) {
  try {
    await extractRequestContext(request);
    const models = modelRegistryService.listModels();
    return apiSuccess({ models, total: models.length });
  } catch (err) {
    return apiError(err);
  }
}
