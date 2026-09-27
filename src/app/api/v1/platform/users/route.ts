import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformUserService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (tenantId) {
      const staff = PlatformUserService.inspectTenantStaff(tenantId, context);
      return apiSuccess(staff);
    }

    const operators = PlatformUserService.listPlatformUsers(context);
    return apiSuccess(operators);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const result = PlatformUserService.assignPlatformRole(body, context);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
