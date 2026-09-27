import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BRAND_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const brands = db.getEnterpriseBrands(orgId);
    return apiSuccess({
      total: brands.length,
      brands,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BRAND_MANAGE);
    const body = await request.json();

    const orgId = resolveOrganizationId(context, body.organization_id);
    const created = enterpriseHierarchyService.createBrand(orgId, {
      business_unit_id: body.business_unit_id || "bu_default",
      name: body.name,
      slug: body.slug || body.name.toLowerCase().replace(/\s+/g, "-"),
      primary_category: body.primary_category || "General",
      currency: body.currency || "BDT",
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
