import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformCommunicationsService } from "@/domains/platform/services/platform-communications.service";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

/**
 * Platform notices for the signed-in workspace: published announcements targeted at it, and maintenance in progress
 * or starting within 72 hours. The tenant comes from the session; targeting details are never returned.
 */
async function handleGET(request: Request) {
  try {
    const ctx = await extractRequestContext(request);
    return apiSuccess(PlatformCommunicationsService.noticesForTenant(ctx.tenant.id));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
