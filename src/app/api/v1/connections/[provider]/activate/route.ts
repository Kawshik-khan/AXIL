import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { getOAuthAdapter, oauthCookieOptions, pendingCookieName } from "@/domains/connectors/auth/oauth-broker";
import { getResourcePicker } from "@/domains/connectors/auth/resource-pickers";
import { readCookie } from "@/domains/social/meta/meta-login.service";
import { RbacService } from "@/domains/rbac/service";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

/**
 * Saves the connection from the pending sign-in and activates the picked resources (ADR-119). Calls the provider outside
 * the store lock (`unit: false`); the services commit their own short units of work.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const context = await extractRequestContext(request);
    const adapter = getOAuthAdapter(provider);
    const picker = getResourcePicker(adapter.slug);
    RbacService.assertCan(context, adapter.permission); // before the tenant-wide limit, so other roles can't use it up
    await enforceRateLimit(`connection_activate:${context.tenant.id}`, 20, 10 * MINUTE);
    const input = parseOrThrow(picker.activateBody, await readJson(request));
    const result = await picker.activate(context, readCookie(request, pendingCookieName(adapter)), input);
    const res = apiSuccess(result);
    res.cookies.set(pendingCookieName(adapter), "", oauthCookieOptions(0)); // done: drop the user token from the browser
    return res;
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false });
