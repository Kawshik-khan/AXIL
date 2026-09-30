import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ServiceTokenService } from "@/domains/automation/services/service-token.service";
import { withStore } from "@/lib/store-unit";

/** Revokes a service token immediately. */
async function handleDELETE(request: Request, { params: rawParams }: { params: Promise<{ id: string }> }) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ service_token: ServiceTokenService.revoke(context, params.id) });
  } catch (err) {
    return apiError(err);
  }
}

export const DELETE = withStore("DELETE", handleDELETE);
