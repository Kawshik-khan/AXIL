import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { ChatSession } from "@/types/social";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const anonymousId = body.anonymous_id || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tenantId = body.tenant_id || "ten_default_dhaka";

    let session = db.findChatSessionByAnonymousId(tenantId, anonymousId);
    if (!session) {
      session = {
        id: `ses_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: tenantId,
        conversation_id: `conv_${anonymousId}`,
        anonymous_id: anonymousId,
        page_url: body.page_url || "",
        referrer: body.referrer,
        user_agent: request.headers.get("user-agent") || undefined,
        ip_address: request.headers.get("x-forwarded-for") || undefined,
        started_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      };
      db.createChatSession(session);
    } else {
      session = db.updateChatSession(tenantId, session.id, {
        page_url: body.page_url || session.page_url,
      });
    }

    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to initialize chat session" },
      { status: 500 }
    );
  }
}
