import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { withStore } from "@/lib/store-unit";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";

async function handleGET(request: Request) {
  try {
    const ctx = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(ctx, "analytics.platform.read");

    const radar = HitlEscalationService.getPlatformRadar();
    return apiSuccess(radar);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
