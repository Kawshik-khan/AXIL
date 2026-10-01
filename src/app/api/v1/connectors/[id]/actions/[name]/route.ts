import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { withStore } from "@/lib/store-unit";

/**
 * POST /api/v1/connectors/[id]/actions/[name] — provider setup actions (connector plan C3, §6).
 * Named, validated, audited actions the UI offers: Telegram set-webhook, webhook-info, etc.
 */
async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const result = await ConnectorService.runAction(context, id, name);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
