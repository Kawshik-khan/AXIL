import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";

export async function DELETE(
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
