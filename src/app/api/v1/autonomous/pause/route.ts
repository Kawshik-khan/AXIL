import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { autonomousControlPlaneService } from "@/domains/autonomous/services";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTONOMOUS_MANAGE);
    const body = await request.json().catch(() => ({}));
    const scopeLevel = body.level || (body.domain ? "DOMAIN" : "ALL");
    const result = autonomousControlPlaneService.pauseAutonomy(
      context.tenant.id,
      { level: scopeLevel, target: body.target || body.domain },
      body.reason || "Paused via control plane API",
      context.user?.id || "admin"
    );
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
