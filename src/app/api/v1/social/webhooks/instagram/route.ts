import { NextResponse } from "next/server";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // No built-in default token (audit H5): without configuration the handshake is refused.
  const expectedToken = process.env.META_VERIFY_TOKEN;
  if (!expectedToken) {
    return new NextResponse("Webhook verification is not configured", { status: 503 });
  }

  if (mode === "subscribe" && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

async function handlePOST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    const result = await WebhookIngressService.handleWebhook(
      "INSTAGRAM",
      rawBody,
      signature,
      Object.fromEntries(request.headers)
    );

    return NextResponse.json({ status: "EVENT_RECEIVED", result }, { status: 200 });
  } catch (err) {
    console.error("Instagram Webhook Ingress Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook processing failed" },
      { status: 200 }
    );
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
