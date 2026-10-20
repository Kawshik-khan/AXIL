import { apiSuccess, apiError } from "@/lib/api-response";
import { withStore } from "@/lib/store-unit";
import { db } from "@/infrastructure/db";
import { readMetaSignedRequest } from "@/domains/connectors/auth/meta-callbacks";
import { handleMetaDeauthorize, identifyUnknownConnections } from "@/domains/connectors/connection-lifecycle";
import { logger } from "@/lib/logger";

/**
 * Meta calls this when a person removes the app from their Facebook account. Authenticated by the signed_request only;
 * deletes that login's tokens and detaches its Pages in every workspace (ADR-119 P4).
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const facebookUserId = await readMetaSignedRequest(request, provider);
    await identifyUnknownConnections(); // migrated connections learn their login first
    const affected = await db.unit(async () => handleMetaDeauthorize(facebookUserId), () => true);
    logger.info("connection.meta_deauthorized", { connections: affected });
    return apiSuccess({ received: true });
  } catch (err) {
    return apiError(err);
  }
}

// Verified and identified before any store write; the writes are one explicit unit
export const POST = withStore("POST", handlePOST, { unit: false });
