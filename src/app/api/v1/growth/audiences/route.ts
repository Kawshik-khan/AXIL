import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { audienceService } from "@/domains/growth/services/audience.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const audiences = audienceService.listAudiences(context.tenant.id);
    return apiSuccess({ audiences, total: audiences.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const audience = audienceService.createAudience({
      tenantId: context.tenant.id,
      name: body.name,
      description: body.description || "",
      type: body.type || "STATIC",
      ruleGroups: body.rule_groups || [],
      predictiveMetadata: body.predictive_metadata,
      createdBy: context.user?.id || "USER",
    });

    return apiSuccess({ audience }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
