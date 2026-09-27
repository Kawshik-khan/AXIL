import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || "Reactivated via Platform Control Plane";

    const activated = PlatformTenantService.activateTenant(id, reason, context);
    return apiSuccess(activated);
  } catch (error) {
    return apiError(error);
  }
}
