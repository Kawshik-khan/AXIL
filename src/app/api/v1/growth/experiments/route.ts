import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { experimentService } from "@/domains/growth/services/experiment.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const experiments = db.getExperiments(context.tenant.id);
    return apiSuccess({ experiments, total: experiments.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();

    const experiment = experimentService.createExperiment({
      tenantId: context.tenant.id,
      name: body.name,
      hypothesis: body.hypothesis,
      primaryMetric: body.primary_metric || "CONVERSION_RATE",
      audienceId: body.audience_id || "",
      variants: body.variants || [],
      minSampleSize: body.min_sample_size,
    });

    return apiSuccess({ experiment }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
