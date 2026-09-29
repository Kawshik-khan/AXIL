import { NextResponse } from "next/server";
import { WebhookGatewayService, WEBHOOK_INGESTION_OPERATION } from "@/domains/automation/services/webhook-gateway.service";
import { CourierSyncService } from "@/domains/automation/services/courier-sync.service";
import { WebhookProvider } from "@/types/automation";
import { CourierProviderName } from "@/types/commerce";
import { logger } from "@/lib/logger";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { checkRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const COURIER_PROVIDERS = new Set<string>(["STEADFAST", "PATHAO", "REDX", "PAPERFLY", "ECOURIER", "SUNDARBAN"]);
const MAX_BODY_BYTES = 256 * 1024;

const reject = (status: number, code: string, message: string, deliveryId?: string) =>
  NextResponse.json({ error: { code, message, ...(deliveryId ? { delivery_id: deliveryId } : {}) } }, { status });

/**
 * Inbound courier / payment webhooks (audit C4, FIX_IMPLEMENTATION_PLAN FX-06, ADR-103).
 *
 * - The endpoint is identified by `?wh=<webhook id>`, a public identifier of one configured webhook row.
 * - The request must carry a fresh `x-webhook-timestamp` (<= 300 s) and `x-webhook-signature`: the hex HMAC of
 *   `<timestamp>.<raw body>` with that row's secret. An Authorization header never replaces the signature.
 * - The tenant is the webhook row's tenant. Client headers and query parameters never choose it, and unknown
 *   endpoints are rejected without writing anything.
 */
async function handlePOST(request: Request, { params }: { params: { provider: string } }) {
  try {
    const provider = params.provider.toUpperCase() as WebhookProvider;
    const webhookId = new URL(request.url).searchParams.get("wh") || "";
    const webhook = webhookId ? WebhookGatewayService.findIngressWebhook(webhookId, provider) : undefined;
    if (!webhook) {
      return reject(401, "UNKNOWN_WEBHOOK", "Unknown or inactive webhook endpoint.");
    }
    // 600 calls per minute per endpoint (FX-14): bounds the rejected-delivery rows a flood of bad signatures can write.
    if (!(await checkRateLimit(`webhook:${webhook.id}`, 600, MINUTE)).allowed) {
      return reject(429, "RATE_LIMITED", "Too many webhook calls for this endpoint.");
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return reject(413, "PAYLOAD_TOO_LARGE", "Webhook payload exceeds the maximum size.");
    }
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      parsedBody = {};
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 1. Signature + timestamp verification against this webhook's own secret.
    const verification = await WebhookGatewayService.processInboundWebhook(webhook.tenant_id, {
      provider,
      endpointPath: `/api/v1/automation/webhooks/${params.provider}`,
      headers,
      rawBody,
      parsedBody,
      webhookId: webhook.id,
    });

    if (!verification.verified) {
      const authFailure = ["INVALID_SIGNATURE", "EXPIRED_TIMESTAMP", "UNKNOWN_WEBHOOK"].includes(verification.code);
      return reject(authFailure ? 401 : 400, verification.code, verification.reason || "Webhook rejected.", verification.deliveryId);
    }

    // A duplicate (already processed, or in progress) is acknowledged without being applied again (STATUS N2).
    if (verification.duplicate) {
      return NextResponse.json({ success: true, verified: true, duplicate: true, delivery_id: verification.deliveryId });
    }

    try {
      const result = await applyWebhook(provider, webhook.tenant_id, parsedBody, verification.deliveryId);
      if (verification.idempotencyKey) {
        IdempotencyService.markCompleted(webhook.tenant_id, verification.idempotencyKey, WEBHOOK_INGESTION_OPERATION, {
          delivery_id: verification.deliveryId,
        });
      }
      return result;
    } catch (processingError) {
      // Release the lock so the provider's retry is processed instead of being dropped as a duplicate.
      if (verification.idempotencyKey) {
        IdempotencyService.markFailed(webhook.tenant_id, verification.idempotencyKey, WEBHOOK_INGESTION_OPERATION, {
          error: processingError instanceof Error ? processingError.message : String(processingError),
        });
      }
      throw processingError;
    }
  } catch (err) {
    logger.error("webhook.processing_failed", {
      provider: params.provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return reject(500, "WEBHOOK_PROCESSING_FAILED", "Error processing webhook.");
  }
}

async function applyWebhook(
  provider: WebhookProvider,
  tenantId: string,
  parsedBody: Record<string, unknown>,
  deliveryId: string
): Promise<NextResponse> {
  // 2. Courier webhooks: apply the canonical status to the webhook tenant's shipment.
  if (COURIER_PROVIDERS.has(provider)) {
    const syncResult = await CourierSyncService.processCourierWebhook(tenantId, provider as CourierProviderName, {
      tracking_number: (parsedBody.tracking_code || parsedBody.tracking_number || parsedBody.consignment_id) as string,
      consignment_id: (parsedBody.consignment_id || parsedBody.invoice_id) as string,
      raw_status: (parsedBody.status || parsedBody.delivery_status || "in_transit") as string,
      status_details: (parsedBody.status_details || parsedBody.reason || parsedBody.notes) as string,
      location: (parsedBody.current_hub || parsedBody.location) as string,
    });

    return NextResponse.json({
      success: true,
      verified: true,
      delivery_id: deliveryId,
      courier_sync: syncResult,
    });
  }

  return NextResponse.json({
    success: true,
    verified: true,
    delivery_id: deliveryId,
    message: `Webhook for ${provider} verified and recorded.`,
  });
}

export const POST = withStore("POST", handlePOST);
