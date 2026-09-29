import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason;

    if (!reason) {
      throw new AppError("REASON_REQUIRED", "Tenant suspension requires a descriptive operational reason.", 400);
    }

    const suspended = PlatformTenantService.suspendTenant(id, reason, context);
    return apiSuccess(suspended);
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
