import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const result = await ConnectorService.testConnection(context, body);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
