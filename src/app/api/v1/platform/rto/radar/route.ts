import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { withStore } from "@/lib/store-unit";
import { RtoScoringService } from "@/domains/rto/rto-scoring.service";

async function handleGET(request: Request) {
  try {
    const ctx = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(ctx, "analytics.platform.read");

    const radar = RtoScoringService.getPlatformFraudRadar();
    return apiSuccess(radar);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
