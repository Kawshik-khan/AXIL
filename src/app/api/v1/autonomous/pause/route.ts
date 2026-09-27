import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { autonomousControlPlaneService } from "@/domains/autonomous/services";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
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
