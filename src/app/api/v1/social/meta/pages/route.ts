import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { MetaLoginService, META_PENDING_COOKIE, metaCookieOptions, readCookie } from "@/domains/social/meta/meta-login.service";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

const ConnectBody = z
  .object({
    page_ids: z.array(z.string().regex(/^\d{1,32}$/)).min(1).max(25),
    include_instagram: z.boolean().default(true),
  })
  .strict();

/** The Pages the signed-in Facebook account manages (read-only; no tokens in the response). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(await MetaLoginService.listPages(context, readCookie(request, META_PENDING_COOKIE)));
  } catch (err) {
    return apiError(err);
  }
}

/** Connects the picked Pages (and their Instagram accounts). Calls Meta outside the store lock. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await enforceRateLimit(`meta_login_connect:${context.tenant.id}`, 20, 10 * MINUTE);
    const input = parseOrThrow(ConnectBody, await readJson(request));
    const results = await MetaLoginService.connectPages(context, readCookie(request, META_PENDING_COOKIE), input);
    const res = apiSuccess({ results });
    res.cookies.set(META_PENDING_COOKIE, "", metaCookieOptions(0)); // done: drop the user token from the browser
    return res;
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST, { unit: false });
