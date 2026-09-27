import { NextResponse } from "next/server";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.META_VERIFY_TOKEN || "commerceos_meta_verify_token_2026";

  if (mode === "subscribe" && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    const result = await WebhookIngressService.handleWebhook(
      "WHATSAPP",
      rawBody,
      signature,
      Object.fromEntries(request.headers)
    );

    return NextResponse.json({ status: "EVENT_RECEIVED", result }, { status: 200 });
  } catch (err) {
    console.error("WhatsApp Webhook Ingress Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook processing failed" },
      { status: 200 }
    );
  }
}
