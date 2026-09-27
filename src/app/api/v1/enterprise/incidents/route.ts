import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseIncidentService } from "@/domains/enterprise/services/enterprise-incident.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.INCIDENTS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const incidents = db.getEnterpriseIncidents(orgId);
    return apiSuccess({
      total: incidents.length,
      open_count: incidents.filter((i) => i.status !== "RESOLVED").length,
      incidents,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.INCIDENTS_MANAGE);
    const body = await request.json();

    if (body.action === "RESOLVE" && body.incident_id) {
      const updated = enterpriseIncidentService.transitionStatus(
        resolveOrganizationId(context, body.organization_id),
        body.incident_id,
        "RESOLVED",
        body.resolution_notes || "Resolved via enterprise operations"
      );
      return apiSuccess(updated);
    }

    const orgId = resolveOrganizationId(context, body.organization_id);
    const created = enterpriseIncidentService.createIncident(orgId, {
      title: body.title,
      domain: body.domain || "INTEGRATION",
      severity: body.severity || "MEDIUM",
      impactedEntities: body.impacted_entities || {},
      rootCause: body.root_cause,
      mitigationPlan: body.mitigation_plan,
      assignedUserId: body.assigned_user_id || context.user?.id,
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
