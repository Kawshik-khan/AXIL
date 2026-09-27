import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseReportingService } from "@/domains/enterprise/services/enterprise-reporting.service";
import { db } from "@/infrastructure/db";
import { EnterpriseUserRecord } from "@/types/enterprise";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXPORTS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const reports = db.getReportDefinitions(orgId);
    return apiSuccess({
      total: reports.length,
      reports,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXPORTS_CREATE);
    const body = await request.json();
    const orgId = body.organization_id || "org_default";

    const caller: EnterpriseUserRecord = {
      id: context.user?.id || "usr_default",
      organization_id: orgId,
      user_id: context.user?.id || "usr_default",
      name: context.user?.name || "Enterprise Admin",
      email: context.user?.email || "admin@commerceos.io",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

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
