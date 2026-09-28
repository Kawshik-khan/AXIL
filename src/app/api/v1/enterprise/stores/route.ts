import { z } from "zod";
import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { enterpriseDataAccessService } from "@/domains/enterprise/services/enterprise-data-access.service";
import { db } from "@/infrastructure/db";

/** Lists only the stores in the caller's enterprise scope (N13). */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.STORE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const stores = enterpriseDataAccessService.getAuthorizedStores(resolveEnterpriseCaller(context, orgId));
    return apiSuccess({ total: stores.length, stores });
  } catch (err) {
    return apiError(err);
  }
}

const CreateStore = z
  .object({
    organization_id: z.string().optional(),
    brand_id: z.string().min(1),
    name: z.string().trim().min(1),
    code: z.string().trim().min(1),
    store_type: z.enum(["ONLINE_STORE", "PHYSICAL_OUTLET", "POPUP", "MARKETPLACE_OUTLET"]).optional(),
    region: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

/**
 * Creates a store under a brand of this organization that the caller manages; the business unit comes from the brand.
 * There used to be `"bu_default"` / `"br_default"` fallbacks and no scope or existence check (N13).
 */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.STORE_MANAGE);
    const body = CreateStore.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);
    const caller = resolveEnterpriseCaller(context, orgId);
    const brand = db.getEnterpriseBrands(orgId).find((b) => b.id === body.brand_id);
    if (!brand) throw new NotFoundError("Brand", body.brand_id);
    const scope = caller.assigned_scope;
    if (!scope.all_access && !scope.brand_ids?.includes(brand.id) && !scope.business_unit_ids?.includes(brand.business_unit_id)) {
      throw new ForbiddenError("That brand is outside your enterprise scope");
    }
    const created = enterpriseHierarchyService.createStore(orgId, {
      business_unit_id: brand.business_unit_id,
      brand_id: brand.id,
      name: body.name,
      code: body.code,
      store_type: body.store_type,
      region: body.region,
      city: body.city,
      currency: body.currency,
    });
    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
