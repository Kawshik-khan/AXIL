import { NextResponse } from "next/server";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { logger } from "@/lib/logger";

/**
 * Server-to-server website chat ingress (audit H5, FX-07).
 * The caller names the channel with `?channel_id=<id>` and signs the raw body with that channel's webhook secret
 * (hex HMAC-SHA256 in `x-commerceos-signature`). Unknown channels are ignored; unsigned requests are rejected.
 * Browser widgets use /api/v1/social/widget/message instead.
 */
export async function POST(request: Request) {
  try {
    const channelId = new URL(request.url).searchParams.get("channel_id");
    if (!channelId) {
      return NextResponse.json({ error: { code: "CHANNEL_REQUIRED", message: "channel_id query parameter is required." } }, { status: 400 });
    }
    const rawBody = await request.text();
    const signature = request.headers.get("x-commerceos-signature");

    const result = await WebhookIngressService.handleWebhook(
      "WEBSITE_CHAT",
      rawBody,
      signature,
      Object.fromEntries(request.headers),
      channelId
    );

    return NextResponse.json({ status: result.success ? "MESSAGE_RECEIVED" : "IGNORED", result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("website_webhook.rejected", { error: message });
    const unauthorized = /signature/i.test(message);
    return NextResponse.json(
      { error: { code: unauthorized ? "INVALID_SIGNATURE" : "WEBHOOK_REJECTED", message: unauthorized ? "Webhook signature verification failed." : "Website chat processing failed." } },
      { status: unauthorized ? 401 : 400 }
    );
  }
}
