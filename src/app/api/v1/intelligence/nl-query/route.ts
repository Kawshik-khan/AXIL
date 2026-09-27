import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { nlAnalyticsService } from "@/domains/intelligence/services/nl-analytics.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    if (!body.query || typeof body.query !== "string") {
      return apiSuccess({ error: "Missing or invalid 'query' string in payload" }, undefined, 400);
    }

    const response = nlAnalyticsService.answerQuestion(context.tenant.id, body.query);
    return apiSuccess(response);
  } catch (err) {
    return apiError(err);
  }
}
