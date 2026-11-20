/**
 * Telegram's calls for an alerts bot (ADR-128): the platform bot at `/api/v1/notifications/telegram/webhook`, a
 * workspace bot at its own `/…/webhook/<key>`. Authenticated by the secret registered with setWebhook
 * (X-Telegram-Bot-Api-Secret-Token); there is no session. The bot a call proves it came through decides which
 * workspaces it may act on, and a workspace is only ever chosen by a one-time code a signed-in user created.
 */
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { TELEGRAM_SECRET_HEADER, type AlertsBotScope } from "./alerts-bot";
import { NotificationService } from "./notification.service";

const MAX_BODY_BYTES = 64 * 1024;

export async function handleAlertsWebhookRequest(request: Request, identify: (secretHeader: string | null) => AlertsBotScope | null): Promise<Response> {
  try {
    const scope = identify(request.headers.get(TELEGRAM_SECRET_HEADER));
    if (!scope) throw new AuthenticationError("Invalid webhook secret.");
    await enforceRateLimit(scope.kind === "platform" ? "notifications:telegram-webhook" : `notifications:telegram-webhook:${scope.tenantId}`, 600, MINUTE);
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
    const result = await NotificationService.handleTelegramUpdate(update, scope);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
