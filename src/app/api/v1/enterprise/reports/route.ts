import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseReportingService } from "@/domains/enterprise/services/enterprise-reporting.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXPORTS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const reports = db.getReportDefinitions(orgId);
    return apiSuccess({
      total: reports.length,
      reports,
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXPORTS_CREATE);
    const body = await request.json();
    const orgId = resolveOrganizationId(context, body.organization_id);

    const caller = resolveEnterpriseCaller(context, orgId); // real role and scope (N11)

    const def = enterpriseReportingService.createReportDefinition(orgId, {
      title: body.title,
      category: body.category || "EXECUTIVE",
      metrics: body.metrics || ["gross_revenue", "order_count"],
      dimensions: body.dimensions || ["STORE"],
      format: body.format || "CSV",
      schedule: body.schedule || "ON_DEMAND",
      recipient_emails: body.recipient_emails,
    });

    // If execute_now flag is set, run immediately
    if (body.execute_now) {
      const result = enterpriseReportingService.executeReport(orgId, def.id, caller, context.tenant.id);
      return apiSuccess({ definition: def, execution: result.execution, exportData: result.exportData }, undefined, 201);
    }

    return apiSuccess(def, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
