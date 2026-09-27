import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

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
    const body = await request.json();

    const orgId = body.organization_id || "org_default";
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
