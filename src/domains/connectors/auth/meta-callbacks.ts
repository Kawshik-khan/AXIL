/**
 * Meta's server-to-server callbacks for the CommerceOS Meta app (ADR-119 P4): "Deauthorize Callback URL" and
 * "Data Deletion Request URL" in the app settings. They carry no session: the `signed_request` (HMAC-SHA256 with the
 * app secret) is the only authentication, and the Facebook user it names is the only input used.
 */
import { AppError, NotFoundError } from "@/lib/errors";
import { clientKey, enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { verifyMetaSignedRequest } from "@/domains/connectors/connection-lifecycle";

/** The Facebook user id from a callback body (form-encoded or JSON `signed_request`), or a 400. */
export async function readMetaSignedRequest(request: Request, provider: string): Promise<string> {
  if (provider !== "meta") throw new NotFoundError("Provider callback");
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appSecret) throw new AppError("META_LOGIN_NOT_CONFIGURED", "The Meta app isn't set up on this server.", 503);
  const raw = (await request.text()).slice(0, 8192);
  let signed = "";
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(raw) as { signed_request?: unknown };
      signed = typeof body.signed_request === "string" ? body.signed_request : "";
    } catch {
      signed = "";
    }
  } else {
    signed = new URLSearchParams(raw).get("signed_request") ?? "";
  }
  const verified = verifyMetaSignedRequest(signed, appSecret);
  if (!verified) {
    // Only failures count against a client, so junk from one sender can't block Meta's genuine callbacks
    const client = clientKey(request);
    if (client) await enforceRateLimit(`meta_callback_fail:${client}`, 60, MINUTE);
    throw new AppError("SIGNED_REQUEST_INVALID", "Invalid signed_request.", 400);
  }
  // Per Facebook user after the signature: a genuine user can't be replayed into a storm of work
  await enforceRateLimit(`meta_callback:${verified.userId}`, 10, MINUTE);
  return verified.userId;
}
