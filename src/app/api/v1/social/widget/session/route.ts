import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { ChatSession } from "@/types/social";
import { logger } from "@/lib/logger";

/**
 * Public website chat session bootstrap (audit H5, FX-07).
 * The tenant comes from the ACTIVE WEBSITE_CHAT channel named by its public id — never from the request body.
 */
const WidgetSession = z
  .object({
    channel_id: z.string().min(1).max(100),
    anonymous_id: z.string().min(1).max(100).optional(),
    page_url: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const parsed = WidgetSession.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_WIDGET_SESSION", message: "channel_id is required." } }, { status: 400 });
    }

    const channel = db.findConnectedChannelForIngress(parsed.data.channel_id);
    if (!channel || channel.type !== "WEBSITE_CHAT" || channel.status !== "ACTIVE") {
      return NextResponse.json({ error: { code: "INVALID_WIDGET_SESSION", message: "Unknown chat channel." } }, { status: 400 });
    }

    const tenantId = channel.tenant_id;
    const anonymousId = parsed.data.anonymous_id || `anon_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    let session: ChatSession | undefined = db.findChatSessionByAnonymousId(tenantId, anonymousId);
    if (!session) {
      session = {
        id: `ses_${crypto.randomUUID()}`,
        tenant_id: tenantId,
        conversation_id: `conv_${anonymousId}`,
        anonymous_id: anonymousId,
        page_url: parsed.data.page_url || "",
        referrer: parsed.data.referrer,
        user_agent: request.headers.get("user-agent") || undefined,
        ip_address: request.headers.get("x-forwarded-for") || undefined,
        started_at: now,
        last_seen_at: now,
      };
      db.createChatSession(session);
    } else {
      session = db.updateChatSession(tenantId, session.id, {
        page_url: parsed.data.page_url || session.page_url,
      });
    }

    return NextResponse.json({ session });
  } catch (err) {
    logger.error("widget_session.failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: { code: "WIDGET_SESSION_FAILED", message: "Failed to initialize chat session." } }, { status: 500 });
  }
}
