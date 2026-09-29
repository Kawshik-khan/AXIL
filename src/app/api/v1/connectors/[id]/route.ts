import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { withStore } from "@/lib/store-unit";

async function handleDELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const success = await ConnectorService.deleteConnector(context, params.id);
    return apiSuccess({ deleted: success });
  } catch (err) {
    return apiError(err);
  }
}

export const DELETE = withStore("DELETE", handleDELETE);
