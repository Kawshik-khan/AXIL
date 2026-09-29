import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiError } from "@/lib/api-response";
import { NotFoundError } from "@/lib/errors";
import { enterpriseReportingService } from "@/domains/enterprise/services/enterprise-reporting.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

/**
 * The report as CSV for the caller's enterprise scope (FX-33 #8: executions advertised this URL, which didn't exist).
 * Computed on request; nothing is stored.
 */
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXPORTS_READ);
    const { id } = await params;
    const orgId = resolveOrganizationId(context, new URL(request.url).searchParams.get("organization_id"));
    const definition = db.getReportDefinitions(orgId).find((r) => r.id === id);
    if (!definition) throw new NotFoundError("Report", id);
    const { csv } = enterpriseReportingService.buildReportCsv(orgId, resolveEnterpriseCaller(context, orgId), context.tenant.id);
    const filename = `${definition.title.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "report"}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
