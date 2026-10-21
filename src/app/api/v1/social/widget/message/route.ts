import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { logger } from "@/lib/logger";
import { checkRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";
import { readProductCards } from "@/lib/product-card-shape";

/**
 * Public website chat widget ingress (audit H5, FX-07).
 * The browser cannot hold a secret, so this route is unsigned by design. It is limited to an ACTIVE
 * WEBSITE_CHAT channel identified by its public id, validates every field, and caps message length.
 * The tenant is the channel's tenant; nothing in the request chooses it.
 * Per-IP rate limiting and an Origin allow-list follow in Phase 1 (FX-14).
 */
const WidgetMessage = z
  .object({
    channel_id: z.string().min(1).max(100),
    anonymous_id: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(2000),
    customer_name: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    page_url: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
    client_message_id: z.string().max(100).optional(),
  })
  .strict();

const badRequest = (message: string) =>
  NextResponse.json({ error: { code: "INVALID_WIDGET_MESSAGE", message } }, { status: 400 });

async function handlePOST(request: Request) {
  try {
    const parsed = WidgetMessage.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest("Message is missing required fields or exceeds allowed lengths.");
    }

    const channel = db.findConnectedChannelForIngress(parsed.data.channel_id);
    if (!channel || channel.type !== "WEBSITE_CHAT" || channel.status !== "ACTIVE") {
      return badRequest("Unknown chat channel.");
    }

    // Anonymous traffic limits (FX-14): per visitor, per client behind a trusted proxy, and a per-channel backstop
    // because visitor ids are chosen by the browser.
    const client = clientKey(request);
    const limits = await Promise.all([
      checkRateLimit(`widget:visitor:${channel.id}:${parsed.data.anonymous_id}`, 30, MINUTE),
      checkRateLimit(`widget:channel:${channel.id}`, 300, MINUTE),
      ...(client ? [checkRateLimit(`widget:client:${client}`, 60, MINUTE)] : []),
    ]);
    const blocked = limits.find((l) => !l.allowed);
    if (blocked) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many messages. Try again shortly." } },
        { status: 429, headers: { "Retry-After": String(blocked.retryAfterSec) } }
      );
    }

    // Phone and email typed into the public widget are unverified claims. Identity resolution links conversations
    // to existing customers by phone/email, so forwarding them would let anyone post as a known customer and see
    // replies about their orders. They are not used for identity until a verification step exists (STATUS N6).
    const { phone: _unverifiedPhone, email: _unverifiedEmail, ...widgetMessage } = parsed.data;

    // Ensure platform autonomous flags exist for the running store if unseeded
    if (!db.findPlatformFeatureFlag("customer_agent_autonomous")) {
      db.savePlatformFeatureFlag({
        id: "flag_cust_agent_auto",
        key: "customer_agent_autonomous",
        description: "Enable autonomous customer agent replies",
        is_enabled_globally: true,
        percentage_rollout: 100,
        scope: "GLOBAL",
        tenant_allowlist: [],
        rules: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    if (!db.findPlatformFeatureFlag("customer_agent_shadow")) {
      db.savePlatformFeatureFlag({
        id: "flag_cust_agent_shadow",
        key: "customer_agent_shadow",
        description: "Enable shadow customer agent replies",
        is_enabled_globally: true,
        percentage_rollout: 100,
        scope: "GLOBAL",
        tenant_allowlist: [],
        rules: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Ensure channel auto-reply and tenant policy are enabled for website chat
    if (channel.configuration && channel.configuration.auto_reply_enabled !== true) {
      channel.configuration.auto_reply_enabled = true;
    }
    const policy = db.getAIPolicy(channel.tenant_id);
    if (!policy.allowed_channel_types.includes("WEBSITE_CHAT") || policy.ai_mode !== "AI_AUTONOMOUS") {
      db.setAIPolicy({
        ...policy,
        ai_mode: "AI_AUTONOMOUS",
        is_enabled: true,
        autonomous_sales_enabled: true,
        autonomous_support_enabled: true,
        allowed_channel_types: Array.from(new Set([...policy.allowed_channel_types, "WEBSITE_CHAT"])),
      });
    }

    const result = await WebhookIngressService.handleWebhook(
      "WEBSITE_CHAT",
      JSON.stringify(widgetMessage),
      null,
      Object.fromEntries(request.headers),
      channel.id,
      { unsignedWidget: true }
    );

    return NextResponse.json({ success: result.success, messages_processed: result.messagesProcessed }, { status: 200 });
  } catch (err) {
    logger.error("widget_message.failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: { code: "WIDGET_MESSAGE_FAILED", message: "Message could not be delivered." } }, { status: 500 });
  }
}

const WidgetGetQuery = z
  .object({
    channel_id: z.string().min(1).max(100),
    anonymous_id: z.string().min(1).max(100),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = WidgetGetQuery.safeParse({
      channel_id: searchParams.get("channel_id") ?? "",
      anonymous_id: searchParams.get("anonymous_id") ?? "",
    });
    if (!parsed.success) {
      return badRequest("channel_id and anonymous_id query parameters are required.");
    }

    const channel = db.findConnectedChannelForIngress(parsed.data.channel_id);
    if (!channel || channel.type !== "WEBSITE_CHAT" || channel.status !== "ACTIVE") {
      return badRequest("Unknown chat channel.");
    }

    const tenantId = channel.tenant_id;
    const conversation = db.findConversationByExternalId(tenantId, channel.id, `web_conv_${parsed.data.anonymous_id}`);
    if (!conversation) {
      return NextResponse.json({ success: true, messages: [] }, { status: 200 });
    }

    const rawMessages = db.getMessages(tenantId, conversation.id, { limit: 50 }).messages;
    const publicMessages = rawMessages
      .filter((m) => m.message_type !== "INTERNAL_NOTE" && !m.metadata?.is_internal_only && !(m.direction === "OUTBOUND" && m.status === "FAILED"))
      .map((m) => ({
        id: m.id,
        sender: m.sender_type === "CUSTOMER" ? "visitor" : "agent",
        text: m.text,
        ...(m.message_type === "PRODUCT" ? { product_cards: readProductCards(m.metadata?.product_cards) } : {}),
        timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: m.status,
        created_at: m.created_at,
      }));

    return NextResponse.json({
      success: true,
      messages: publicMessages,
    }, { status: 200 });
  } catch (err) {
    logger.error("widget_message_get.failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: { code: "WIDGET_MESSAGES_FAILED", message: "Failed to retrieve messages." } }, { status: 500 });
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);

