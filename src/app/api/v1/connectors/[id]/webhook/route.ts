import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { decryptCredential } from "@/lib/security";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { WebhookIngressService, rawEventId } from "@/domains/social/webhooks/webhook-ingress.service";
import { TelegramAdapter, TELEGRAM_SECRET_HEADER } from "@/domains/social/channels/adapters/telegram.adapter";
import { BadRequestError, AuthenticationError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { withStore } from "@/lib/store-unit";
import { forwardRawToN8n, isSocialChannel, socialN8nEnabled } from "@/domains/social/n8n/bridge";
import crypto from "crypto";

/**
 * Generic connector webhook ingress (connector plan C3, §6).
 *
 * Provider webhooks for connectors that have one (Telegram today) arrive here. The connector id in the path
 * identifies the tenant and the provider; the request itself carries no tenant information. The provider's own
 * secret (Telegram's secret_token, verified in constant time) authenticates the request.
 *
 * GET is accepted so a merchant can check the endpoint is reachable; it never processes an event.
 */

async function handleGET() {
  return NextResponse.json({ status: "OK", message: "Connector webhook endpoint is reachable." });
}

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const { id } = await rawParams;

  // 1. Resolve the connector by its public id. The row's tenant_id is authoritative; no tenant comes from the request.
  const connector = db.findConnectorForIngress(id);
  if (!connector) {
    throw new NotFoundError(`Connector '${id}' not found.`);
  }
  if (connector.enabled === false) {
    throw new BadRequestError("This connector is disabled.");
  }

  // 2. Find the channel this connector feeds (D3: the channel references the connector).
  const channel = db.getConnectedChannels(connector.tenant_id).find((c) => c.connector_id === connector.id);
  if (!channel) {
    throw new BadRequestError(`No channel is connected to connector '${id}'.`);
  }

  // 3. Verify the provider's signature. Each provider has its own mechanism.
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);

  const credentials = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted);
  const adapter = ChannelService.getAdapter(channel.type);

  let verified = false;
  if (channel.type === "TELEGRAM") {
    // Telegram: X-Telegram-Bot-Api-Secret-Token header, constant-time compare
    const expected = typeof credentials.webhook_secret === "string" ? credentials.webhook_secret : "";
    const given = headers[TELEGRAM_SECRET_HEADER] ?? headers[TELEGRAM_SECRET_HEADER.toUpperCase()] ?? "";
    if (expected && given) {
      const a = crypto.createHash("sha256").update(expected).digest();
      const b = crypto.createHash("sha256").update(given).digest();
      verified = crypto.timingSafeEqual(a, b);
    }
  } else {
    // Other providers: use the adapter's verifyWebhook with the connector's credentials
    const signature = headers["x-hub-signature-256"] ?? null;
    verified = adapter.verifyWebhook(rawBody, signature, headers, credentials as any);
  }

  if (!verified) {
    logger.warn("connector_webhook.signature_rejected", { connector_id: id, channel_type: channel.type });
    throw new AuthenticationError("Webhook signature verification failed.");
  }

  // 4. Parse the inbound event
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new BadRequestError("Webhook payload is not valid JSON.");
  }

  // 5. n8n is the preferred normalizer for social channels (connector plan C3). If it can't take the event,
  //    CommerceOS normalizes it itself so a customer's message is never lost.
  if (socialN8nEnabled() && isSocialChannel(channel.type)) {
    try {
      await forwardRawToN8n(channel, rawEventId(channel.id, payload), payload);
      return NextResponse.json({ status: "EVENT_RECEIVED", forwarded_to_n8n: true });
    } catch (err) {
      logger.warn("connector_webhook.n8n_fallback", { connector_id: id, error: err instanceof Error ? err.name : "Error" });
    }
  }

  // Direct normalization fallback
  const normalizedMessages = adapter.normalizeIncomingEvent(payload, channel.id);
  const receipts = adapter.parseDeliveryReceipts(payload);

  const result = await db.unit(
    () => WebhookIngressService.ingestNormalized(channel, normalizedMessages, receipts),
    () => true
  );

  return NextResponse.json({ status: "EVENT_RECEIVED", ...result });
}

export const GET = withStore("GET", handleGET);
// n8n forwarding is an external call; direct ingestion and its messages/events commit in a short unit afterward.
export const POST = withStore("POST", handlePOST, { unit: false });
