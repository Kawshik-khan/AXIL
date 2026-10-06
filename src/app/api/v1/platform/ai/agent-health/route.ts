import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { AgentHealthService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

/** Customer-agent health across every workspace, last 24 hours (FX-81). Read-only. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(AgentHealthService.getHealth(context));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
