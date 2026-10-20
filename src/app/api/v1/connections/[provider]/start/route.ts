import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OAuthBroker, getOAuthAdapter, nonceCookieName, oauthCookieOptions } from "@/domains/connectors/auth/oauth-broker";
import { RbacService } from "@/domains/rbac/service";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

const StartBody = z
  .object({ features: z.array(z.string().regex(/^[a-z_]{1,32}$/)).max(5).default([]) })
  .strict();

/** Starts a provider sign-in: returns the dialog URL and binds the round trip to this browser (ADR-119). */
async function handlePOST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const context = await extractRequestContext(request);
    const adapter = getOAuthAdapter(provider);
    RbacService.assertCan(context, adapter.permission); // before the tenant-wide limit, so other roles can't use it up
    await enforceRateLimit(`connection_start:${context.tenant.id}`, 20, 10 * MINUTE);
    // An empty body means no optional features
    const input = parseOrThrow(StartBody, await readJson(request));
    const { url, nonce } = await OAuthBroker.start(context, adapter.slug, input.features);
    const res = apiSuccess({ url });
    res.cookies.set(nonceCookieName(adapter), nonce, oauthCookieOptions(10 * 60));
    return res;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
