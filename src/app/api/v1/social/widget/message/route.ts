import { NextResponse } from "next/server";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawBody = JSON.stringify(body);

    const result = await WebhookIngressService.handleWebhook(
      "WEBSITE_CHAT",
      rawBody,
      null,
      Object.fromEntries(request.headers),
      body.channel_id
    );

    return NextResponse.json({ success: true, result }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Widget message delivery failed" },
      { status: 400 }
    );
  }
}
