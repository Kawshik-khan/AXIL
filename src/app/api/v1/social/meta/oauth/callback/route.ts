import { NextResponse } from "next/server";
import { extractRequestContext } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  appOrigin,
  MetaLoginService,
  META_NONCE_COOKIE,
  META_PENDING_COOKIE,
  metaCookieOptions,
  readCookie,
} from "@/domains/social/meta/meta-login.service";
import { withStore } from "@/lib/store-unit";

const PICKER_PATH = "/connector/facebook";

/**
 * Facebook redirects here after the merchant signs in. Writes nothing to the store (GET): the long-lived user token goes
 * into an encrypted, httpOnly, 15-minute cookie, and the merchant picks Pages on the next screen. Only a short code is
 * put in the redirect URL, never Meta's error text.
 */
async function handleGET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`${PICKER_PATH}?${query}`, appOrigin(url.origin)), 303);
    res.cookies.set(META_NONCE_COOKIE, "", metaCookieOptions(0));
    return res;
  };
  try {
    const context = await extractRequestContext(request);
    const pending = await MetaLoginService.completeCallback(
      context,
      { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") },
      readCookie(request, META_NONCE_COOKIE)
    );
    const res = back("step=pick");
    res.cookies.set(META_PENDING_COOKIE, pending, metaCookieOptions(15 * 60));
    return res;
  } catch (err) {
    const code = err instanceof AppError ? err.code : "UNKNOWN";
    logger.warn("meta_login.callback_failed", { code });
    return back(`error=${encodeURIComponent(code)}`);
  }
}

export const GET = withStore("GET", handleGET);
