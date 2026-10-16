import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { isAlertsWebhookCall, TELEGRAM_SECRET_HEADER } from "@/domains/notifications/alerts-bot";
import { NotificationService } from "@/domains/notifications/notification.service";
import { withStore } from "@/lib/store-unit";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Telegram's calls for the CommerceOS alerts bot. Authenticated by the secret registered with setWebhook (header
 * X-Telegram-Bot-Api-Secret-Token); there is no session. A workspace is only ever chosen by the one-time code a
 * signed-in user created (NotificationService.handleTelegramUpdate).
 */
async function handlePOST(request: Request) {
  try {
    if (!isAlertsWebhookCall(request.headers.get(TELEGRAM_SECRET_HEADER))) throw new AuthenticationError("Invalid webhook secret.");
    await enforceRateLimit("notifications:telegram-webhook", 600, MINUTE);
    // Nothing an alerts bot needs is this large: dropped unparsed (and unread when the length is declared)
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ ok: true });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ ok: true });
    let update: unknown = null;
    try {
      update = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: true }); // not JSON: acknowledged so Telegram doesn't retry it forever
    }
    const result = await NotificationService.handleTelegramUpdate(update);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
