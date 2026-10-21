import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { withStore } from "@/lib/store-unit";
import { db } from "@/infrastructure/db";
import { readMetaSignedRequest } from "@/domains/connectors/auth/meta-callbacks";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { unsubscribeUnusedWabas, wabasOfConnection } from "@/domains/social/whatsapp/whatsapp-signup.service";
import { META_APP_PROVIDERS, handleMetaDataDeletion, identifyUnknownConnections, unidentifiedSignInConnections } from "@/domains/connectors/connection-lifecycle";
import { logger } from "@/lib/logger";

/**
 * Meta's data deletion request (ADR-119 P4): deletes what CommerceOS holds about that Facebook login and answers in the
 * shape Meta requires: `{ url, confirmation_code }`, where `url` shows the deletion's status.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const facebookUserId = await readMetaSignedRequest(request, provider);
    // Migrated connections learn whose login they hold first; one Meta can't answer for blocks a "completed" answer
    await identifyUnknownConnections(500);
    // WhatsApp accounts reached only through this login stop sending webhooks to the platform app
    for (const c of db.data.connector_configurations || []) {
      if (c.provider_id === "whatsapp_cloud" && c.auth_method === "oauth2" && c.external_account_id === facebookUserId) {
        await unsubscribeUnusedWabas(wabasOfConnection(c.tenant_id, c.id), OAuthBroker.storedToken(c), c.id);
      }
    }
    const pending = unidentifiedSignInConnections(META_APP_PROVIDERS).length;
    const { code, deleted } = await db.unit(
      async () => handleMetaDataDeletion(facebookUserId, process.env.META_APP_SECRET ?? "", pending > 0 ? "IN_PROGRESS" : "COMPLETED"),
      () => true
    );
    logger.info("connection.meta_data_deleted", { connections: deleted, unidentified: pending });
    const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
    return NextResponse.json({ url: `${base}/api/v1/connections/meta/data-deletion/${encodeURIComponent(code)}`, confirmation_code: code });
  } catch (err) {
    return apiError(err);
  }
}

// Verified and identified before any store write; the writes are one explicit unit
export const POST = withStore("POST", handlePOST, { unit: false });
