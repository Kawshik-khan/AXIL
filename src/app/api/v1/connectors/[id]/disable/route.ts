import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { withStore } from "@/lib/store-unit";

/**
 * POST /api/v1/connectors/[id]/disable — pause a connector without deleting it.
 */
async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const { id } = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const result = await ConnectorService.setEnabled(context, id, false);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
