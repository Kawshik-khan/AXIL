import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { semanticMetricsService } from "@/domains/enterprise/services/semantic-metrics.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.METRICS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";
    const metricKey = searchParams.get("metric_key");

    if (metricKey) {
      const result = semanticMetricsService.queryMetric(
        {
          metric_key: metricKey,
          entity_type: "ORGANIZATION",
          entity_id: orgId,
        },
        context.tenant.id
      );
      return apiSuccess(result);
    }

    let defs = db.getSemanticMetrics(orgId);
    if (defs.length === 0) {
      defs = semanticMetricsService.seedStandardMetrics(orgId);
    }

    return apiSuccess({
      total: defs.length,
      metrics: defs,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.METRICS_MANAGE);
    const body = await request.json();
    const orgId = body.organization_id || "org_default";

    const result = semanticMetricsService.queryMetric(
      {
        metric_key: body.metric_key,
        entity_type: body.entity_type || "ORGANIZATION",
        entity_id: body.entity_id || orgId,
        dimensions: body.dimensions,
      },
      context.tenant.id
    );

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
