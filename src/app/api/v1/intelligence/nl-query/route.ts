import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { nlAnalyticsService } from "@/domains/intelligence/services/nl-analytics.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    enforceRateLimit(`ai:user:${context.user.id}`, 30, MINUTE); // costly model calls (FX-14)
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
