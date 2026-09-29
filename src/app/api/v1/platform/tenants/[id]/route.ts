import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const detail = PlatformTenantService.getTenantDetail(id, context);
    return apiSuccess(detail);
  } catch (error) {
    return apiError(error);
  }
}

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || "Tenant archived via Platform Control Plane";
    const archived = PlatformTenantService.archiveTenant(id, reason, context);
    return apiSuccess(archived);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const DELETE = withStore("DELETE", handleDELETE);
