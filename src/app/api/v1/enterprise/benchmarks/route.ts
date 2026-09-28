import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseBenchmarkingService } from "@/domains/enterprise/services/enterprise-benchmarking.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BENCHMARKS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const metricKey = searchParams.get("metric_key") || "gross_revenue";
    const benchmarkType = searchParams.get("type") || "STORE";

    const caller = resolveEnterpriseCaller(context, orgId); // real role and scope (N11)

    // Computed for this request, not stored (FX-21)
    const benchmark =
      benchmarkType === "BRAND"
        ? enterpriseBenchmarkingService.generateBrandBenchmark(orgId, metricKey, caller, { persist: false })
        : enterpriseBenchmarkingService.generateStoreBenchmark(orgId, metricKey, caller, context.tenant.id, { persist: false });

    return apiSuccess(benchmark);
  } catch (err) {
    return apiError(err);
  }
}
