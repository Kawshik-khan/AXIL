import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { decryptCredential } from "@/lib/security";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { TelegramAdapter, TELEGRAM_SECRET_HEADER, telegramCall } from "@/domains/social/channels/adapters/telegram.adapter";
import { BadRequestError, AuthenticationError, NotFoundError } from "@/lib/errors";
import { apiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withStore } from "@/lib/store-unit";
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

async function ingest(request: Request, id: string) {
  // 1. Resolve the connector by its public id. The row's tenant_id is authoritative; no tenant comes from the request.
  // 2. Find the channel this connector feeds (D3: the channel references the connector).
  // Before the signature is checked, an unknown, disabled or unconnected connector all get the same 404: an
  // unauthenticated caller learns nothing about its state. The reason goes to the log only.
  const connector = db.findConnectorForIngress(id);
  const channel = connector && connector.enabled !== false
    ? db.getConnectedChannels(connector.tenant_id).find((c) => c.connector_id === connector.id)
    : undefined;
  if (!connector || !channel) {
    const reason = !connector ? "unknown" : connector.enabled === false ? "disabled" : "no_channel";
    logger.warn("connector_webhook.unroutable", { connector_id: id, reason });
    throw new NotFoundError("Connector", id);
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

  // 5. Normalize the event
  const normalizedMessages = adapter.normalizeIncomingEvent(payload, channel.id);
  const receipts = adapter.parseDeliveryReceipts(payload);

  const result = await db.unit(
    () => WebhookIngressService.ingestNormalized(channel, normalizedMessages, receipts),
    () => true
  );

  // A pressed button shows a spinner until the bot answers it. Best effort, after the tap is stored and outside the
  // store's unit: if Telegram can't be reached the spinner just times out.
  const callbackId = (payload.callback_query as { id?: unknown } | undefined)?.id;
  if (channel.type === "TELEGRAM" && typeof callbackId === "string") {
    await telegramCall(credentials, "answerCallbackQuery", { callback_query_id: callbackId }).catch((err: unknown) =>
      logger.warn("connector_webhook.callback_answer_failed", { connector_id: id, error: (err as Error).message })
    );
  }

  return NextResponse.json({ status: "EVENT_RECEIVED", ...result });
}

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const { id } = await rawParams;
  try {
    return await ingest(request, id);
  } catch (err) {
    // An unknown connector or a bad signature is the caller's error (4xx), not a crash: a 500 makes Telegram retry
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
// Ingestion and its messages/events commit in their own short unit.
export const POST = withStore("POST", handlePOST, { unit: false });
