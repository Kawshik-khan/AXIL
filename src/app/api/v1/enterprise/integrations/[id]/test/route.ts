import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { integrationHubService } from "@/domains/enterprise/services/integration-hub.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;

    const result = integrationHubService.testConnection(id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
