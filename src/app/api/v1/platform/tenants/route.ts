import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const plan_id = searchParams.get("plan_id") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    const result = PlatformTenantService.listTenants({ search, status, plan_id, limit, offset }, context);
    return apiSuccess(result.tenants, { total: result.total, limit, offset });
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const result = PlatformTenantService.provisionTenant(body, context);
    return apiSuccess(result, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
