import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { withStore } from "@/lib/store-unit";

/**
 * POST /api/v1/connectors/[id]/rotate-secret — generate a new webhook secret (connector plan C3, §6).
 * The new secret is returned once; it is stored encrypted and never shown again.
 */
async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const { id } = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const result = await ConnectorService.rotateSecret(context, id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
