import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAttentionService } from "@/domains/platform/services/platform-attention.service";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

/** The Control Tower inbox, computed from current platform state on every read (never stored). */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(await PlatformAttentionService.list(context));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
