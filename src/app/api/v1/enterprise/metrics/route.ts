import { z } from "zod";
import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { semanticMetricsService } from "@/domains/enterprise/services/semantic-metrics.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.METRICS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const metricKey = searchParams.get("metric_key");

    if (metricKey) {
      // Evaluated for the caller's scope (N13); organization values need organization-wide scope
      const result = semanticMetricsService.queryMetric(
        orgId,
        { metric_key: metricKey, entity_type: "ORGANIZATION", entity_id: orgId },
        context.tenant.id,
        resolveEnterpriseCaller(context, orgId)
      );
      return apiSuccess(result);
    }

    const defs = semanticMetricsService.listMetrics(orgId); // read-only (FX-21)
    return apiSuccess({ total: defs.length, metrics: defs });
  } catch (err) {
    return apiError(err);
  }
}

const QueryBody = z
  .object({
    organization_id: z.string().optional(),
    metric_key: z.string().min(1),
    entity_type: z.enum(["ORGANIZATION", "BUSINESS_UNIT", "BRAND", "STORE"]).optional(),
    entity_id: z.string().min(1).optional(),
    time_grain: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]).optional(),
    dimensions: z.record(z.string()).optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.METRICS_MANAGE);
    const body = QueryBody.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);
    const entityType = body.entity_type || "ORGANIZATION";

    const result = semanticMetricsService.queryMetric(
      orgId,
      {
        metric_key: body.metric_key,
        entity_type: entityType,
        entity_id: entityType === "ORGANIZATION" ? orgId : body.entity_id,
        time_grain: body.time_grain,
        dimensions: body.dimensions,
      },
      context.tenant.id,
      resolveEnterpriseCaller(context, orgId)
    );
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
