import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { withStore } from "@/lib/store-unit";
import { ConnectionsService } from "@/domains/connectors/connections.service";

/** The workspace's connections, their resources and a status per provider (read-only; no credentials). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(ConnectionsService.list(context));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
