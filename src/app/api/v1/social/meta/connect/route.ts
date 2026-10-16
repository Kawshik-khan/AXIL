import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { MetaLoginService, META_NONCE_COOKIE, metaCookieOptions } from "@/domains/social/meta/meta-login.service";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

/** Starts "Connect with Facebook": returns the Facebook dialog URL and binds the round trip to this browser. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await enforceRateLimit(`meta_login_start:${context.tenant.id}`, 20, 10 * MINUTE);
    const { url, nonce } = await MetaLoginService.start(context);
    const res = apiSuccess({ url });
    res.cookies.set(META_NONCE_COOKIE, nonce, metaCookieOptions(10 * 60));
    return res;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
