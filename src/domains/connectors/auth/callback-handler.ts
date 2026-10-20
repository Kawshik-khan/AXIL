import { NextResponse } from "next/server";
import { extractRequestContext } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  OAuthBroker,
  appOrigin,
  getOAuthAdapter,
  nonceCookieName,
  oauthCookieOptions,
  pendingCookieName,
} from "@/domains/connectors/auth/oauth-broker";
import { readCookie } from "@/domains/social/meta/meta-login.service";

/**
 * The provider redirects here after sign-in (ADR-119). Writes nothing to the store (GET): the token goes into an
 * encrypted, httpOnly, 15-minute cookie and the merchant picks resources on the next screen. Only a short code is put in
 * the redirect URL, never the provider's error text.
 */
export async function handleConnectionCallback(request: Request, slug: string) {
  const url = new URL(request.url);
  let adapter;
  try {
    adapter = getOAuthAdapter(slug);
  } catch {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown provider." } }, { status: 404 });
  }
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`${adapter.pickerPath}?${query}`, appOrigin(adapter, url.origin)), 303);
    res.cookies.set(nonceCookieName(adapter), "", oauthCookieOptions(0));
    return res;
  };
  try {
    const context = await extractRequestContext(request);
    const pending = await OAuthBroker.completeCallback(
      context,
      adapter.slug,
      { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") },
      readCookie(request, nonceCookieName(adapter))
    );
    const res = back("step=pick");
    res.cookies.set(pendingCookieName(adapter), pending, oauthCookieOptions(15 * 60));
    return res;
  } catch (err) {
    const code = err instanceof AppError ? err.code : "UNKNOWN";
    logger.warn("connection.callback_failed", { provider: adapter.slug, code });
    return back(`error=${encodeURIComponent(code)}`);
  }
}
