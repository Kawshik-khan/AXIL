import { z } from "zod";
import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { enterpriseDataAccessService } from "@/domains/enterprise/services/enterprise-data-access.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

/** Lists only the brands in the caller's enterprise scope (N13). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BRAND_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const brands = enterpriseDataAccessService.getAuthorizedBrands(resolveEnterpriseCaller(context, orgId));
    return apiSuccess({ total: brands.length, brands });
  } catch (err) {
    return apiError(err);
  }
}

const CreateBrand = z
  .object({
    organization_id: z.string().optional(),
    business_unit_id: z.string().min(1),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1).optional(),
    primary_category: z.string().trim().min(1).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

/**
 * Creates a brand under a business unit of this organization that the caller manages. There used to be a
 * `"bu_default"` fallback and no check that the unit existed or was in the caller's scope (N13).
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BRAND_MANAGE);
    const body = CreateBrand.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);
    const caller = resolveEnterpriseCaller(context, orgId);
    const unit = db.getBusinessUnits(orgId).find((bu) => bu.id === body.business_unit_id);
    if (!unit) throw new NotFoundError("Business unit", body.business_unit_id);
    if (!caller.assigned_scope.all_access && !caller.assigned_scope.business_unit_ids?.includes(unit.id)) {
      throw new ForbiddenError("That business unit is outside your enterprise scope");
    }
    const created = enterpriseHierarchyService.createBrand(orgId, {
      business_unit_id: unit.id,
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

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
