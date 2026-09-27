import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BUSINESS_UNIT_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const units = db.getBusinessUnits(orgId);
    return apiSuccess({
      total: units.length,
      business_units: units,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BUSINESS_UNIT_MANAGE);
    const body = await request.json();

    const orgId = resolveOrganizationId(context, body.organization_id);
    const created = enterpriseHierarchyService.createBusinessUnit(orgId, {
      name: body.name,
      code: body.code,
      description: body.description,
      budget_allocated_bdt: body.budget_allocated_bdt,
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
