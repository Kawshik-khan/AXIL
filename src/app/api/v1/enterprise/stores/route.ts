import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const stores = db.getEnterpriseStores(orgId);
    return apiSuccess({
      total: stores.length,
      stores,
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
    const created = enterpriseHierarchyService.createStore(orgId, {
      business_unit_id: body.business_unit_id || "bu_default",
      brand_id: body.brand_id || "br_default",
      name: body.name,
      code: body.code,
      store_type: body.channel_type || body.store_type || "ONLINE_STORE",
      currency: body.currency || "BDT",
    });

    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
