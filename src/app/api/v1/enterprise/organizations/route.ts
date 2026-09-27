import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ORGANIZATION_READ);
    // Only this workspace's own organizations (FX-13).
    const orgs = db.getOrganizations().filter((o) => o.tenant_id === context.tenant.id);
    return apiSuccess({
      total: orgs.length,
      organizations: orgs,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ORGANIZATION_MANAGE);
    const body = await request.json();

    const created = enterpriseHierarchyService.createOrganization({
      tenantId: context.tenant.id,
      name: body.name,
      slug: body.slug || body.name.toLowerCase().replace(/\s+/g, "-"),
      legal_name: body.legal_name || body.name,
      headquarters_country: body.country || "Bangladesh",
      default_currency: body.base_currency || "BDT",
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
