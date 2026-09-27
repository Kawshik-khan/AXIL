import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ServiceTokenService } from "@/domains/automation/services/service-token.service";

/** Revokes a service token immediately. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ service_token: ServiceTokenService.revoke(context, params.id) });
  } catch (err) {
    return apiError(err);
  }
}
