import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { withStore } from "@/lib/store-unit";

/**
 * POST /api/v1/connectors/[id]/enable and /disable — pause or resume a connector without deleting it.
 */
async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const { id } = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const url = new URL(request.url);
    const action = url.pathname.endsWith("/enable") ? "enable" : "disable";
    const result = await ConnectorService.setEnabled(context, id, action === "enable");
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
