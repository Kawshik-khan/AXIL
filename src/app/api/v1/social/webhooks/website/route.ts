import { NextResponse } from "next/server";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-commerceos-signature");

    const result = await WebhookIngressService.handleWebhook(
      "WEBSITE_CHAT",
      rawBody,
      signature,
      Object.fromEntries(request.headers)
    );

    return NextResponse.json({ status: "MESSAGE_RECEIVED", result }, { status: 200 });
  } catch (err) {
    console.error("Website Chat Webhook Ingress Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Website chat processing failed" },
      { status: 400 }
    );
  }
}
