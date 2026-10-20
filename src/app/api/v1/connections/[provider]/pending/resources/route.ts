import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { getOAuthAdapter, pendingCookieName } from "@/domains/connectors/auth/oauth-broker";
import { getResourcePicker } from "@/domains/connectors/auth/resource-pickers";
import { readCookie } from "@/domains/social/meta/meta-login.service";
import { withStore } from "@/lib/store-unit";

/** What the signed-in provider account can connect (read-only; no tokens in the response). */
async function handleGET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const context = await extractRequestContext(request);
    const adapter = getOAuthAdapter(provider);
    const picker = getResourcePicker(adapter.slug);
    return apiSuccess(await picker.list(context, readCookie(request, pendingCookieName(adapter))));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
