/**
 * Meta (Facebook Login for Business) sign-in adapter (ADR-119, P1). One CommerceOS Meta app serves every workspace.
 * Every Graph call carries `appsecret_proof` and goes through outboundRequest (ADR-110); Meta's error text is shortened
 * and token-shaped runs are removed before anything is shown.
 */
import crypto from "crypto";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { outboundRequest, OutboundBlockedError, OutboundNetworkError, OutboundTimeoutError } from "@/lib/outbound-http";
import type { OAuthAdapter, TokenInspection, TokenSet } from "./types";

export const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const CALL_TIMEOUT_MS = 10_000;

interface MetaAppConfig {
  appId: string;
  appSecret: string;
}

/** The platform's Meta app (META_APP_ID / META_APP_SECRET), or META_LOGIN_NOT_CONFIGURED. */
export function metaAppConfig(): MetaAppConfig {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appId || !appSecret) {
    throw new AppError("META_LOGIN_NOT_CONFIGURED", "Connect with Facebook isn't set up on this server (META_APP_ID, META_APP_SECRET and APP_URL).", 503);
  }
  return { appId, appSecret };
}

/** The part of a Meta error that is safe to show: short, with anything token-shaped removed. */
function safeError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200);
}

/** One Graph API call. `token` is sent with its `appsecret_proof`; params never carry a user token. */
export async function metaGraph(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string>,
  token?: string
): Promise<Record<string, unknown>> {
  const appSecret = process.env.META_APP_SECRET ?? "";
  const query = new URLSearchParams(params);
  if (token) {
    query.set("access_token", token);
    if (appSecret) query.set("appsecret_proof", crypto.createHmac("sha256", appSecret).update(token).digest("hex"));
  }
  const inBody = method === "POST";
  let res;
  try {
    res = await outboundRequest(`${GRAPH_API}${path}${inBody ? "" : `?${query}`}`, {
      method,
      headers: inBody ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: inBody ? query.toString() : undefined,
      timeoutMs: CALL_TIMEOUT_MS,
      maxResponseBytes: 512 * 1024,
      platformConfigured: true,
    });
  } catch (err) {
    if (err instanceof OutboundBlockedError || err instanceof OutboundTimeoutError || err instanceof OutboundNetworkError) {
      throw new AppError("META_UNREACHABLE", "Facebook could not be reached. Try again.", 502);
    }
    throw err;
  }
  let parsed: Record<string, unknown> & { error?: { code?: number; message?: string } } = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {
    // not JSON: handled below
  }
  if (res.status >= 200 && res.status < 300 && !parsed.error) return parsed;
  const code = parsed.error?.code ?? res.status;
  if (code === 190) throw new AppError("META_TOKEN_INVALID", "Facebook sign-in expired or was revoked. Connect again.", 401);
  if (code === 4 || code === 17 || code === 32) throw new AppError("META_RATE_LIMITED", "Facebook rate limit hit. Try again in a few minutes.", 429);
  if (code === 10 || code === 200) throw new AppError("META_PERMISSION_DENIED", "Facebook didn't grant the permission this needs.", 403);
  throw new AppError("META_API_ERROR", `Facebook refused the request: ${safeError(parsed.error?.message)}`, 502);
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export const metaOAuthAdapter: OAuthAdapter = {
  slug: "meta",
  providerId: "meta_graph",
  permission: PERMISSIONS.SOCIAL_CHANNEL_MANAGE,
  cookiePrefix: "cos_meta",
  pickerPath: "/connector/facebook",
  deniedCode: "META_DENIED",

  assertConfigured() {
    metaAppConfig();
  },

  authorizeUrl({ state, redirectUri, scopes }) {
    const url = new URL(DIALOG_URL);
    url.searchParams.set("client_id", metaAppConfig().appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    return url.toString();
  },

  async exchangeCode(code, redirectUri): Promise<TokenSet> {
    const { appId, appSecret } = metaAppConfig();
    const short = await metaGraph("GET", "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    const shortToken = str(short.access_token);
    if (!shortToken) throw new AppError("META_API_ERROR", "Facebook did not return an access token.", 502);
    // Page tokens fetched with a long-lived user token don't expire
    const long = await metaGraph("GET", "/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    });
    return { accessToken: str(long.access_token) || shortToken };
  },

  async inspect(token): Promise<TokenInspection> {
    const { appId, appSecret } = metaAppConfig();
    // The app token (id|secret) inspects the user token; it is a param here, never sent anywhere but graph.facebook.com
    let res: Record<string, unknown>;
    try {
      res = await metaGraph("GET", "/debug_token", { input_token: token.accessToken, access_token: `${appId}|${appSecret}` });
    } catch (err) {
      // An error from /debug_token itself (most often the app token: a wrong or rotated META_APP_SECRET) says nothing
      // about the user's token. Only `is_valid: false` or another app's token below means the token is bad.
      if (err instanceof AppError && err.code === "META_UNREACHABLE") throw err;
      throw new AppError("META_INSPECT_FAILED", "Facebook couldn't check this sign-in. Try again later.", 502);
    }
    const data = (res.data ?? {}) as Record<string, unknown>;
    if (data.is_valid !== true) throw new AppError("META_TOKEN_INVALID", "Facebook sign-in expired or was revoked. Connect again.", 401);
    if (str(data.app_id) !== appId) throw new AppError("META_TOKEN_INVALID", "This Facebook sign-in was made for another app.", 401);
    const externalAccountId = str(data.user_id);
    if (!/^\d{1,32}$/.test(externalAccountId)) throw new AppError("META_API_ERROR", "Facebook didn't say who signed in.", 502);
    const scopes = Array.isArray(data.scopes) ? (data.scopes as unknown[]).map(String).filter((s) => /^[a-z_]{1,64}$/.test(s)) : [];
    const expires = typeof data.expires_at === "number" && data.expires_at > 0 ? new Date(data.expires_at * 1000).toISOString() : undefined;
    const targets: Record<string, string[]> = {};
    for (const g of Array.isArray(data.granular_scopes) ? (data.granular_scopes as Array<Record<string, unknown>>) : []) {
      const scope = str(g.scope);
      if (!/^[a-z_]{1,64}$/.test(scope) || !Array.isArray(g.target_ids)) continue;
      targets[scope] = (g.target_ids as unknown[]).map(str).filter((id) => /^\d{1,32}$/.test(id)).slice(0, 50);
    }
    return { externalAccountId, scopes, expiresAt: expires, targets };
  },
};

/**
 * WhatsApp Embedded Signup (ADR-119 P5) on the same Meta app: Facebook Login for Business with the app's Embedded Signup
 * configuration (`META_WA_CONFIG_ID`). The merchant creates or picks a WhatsApp Business Account and number in Meta's
 * dialog; CommerceOS then learns which accounts the token reaches from Meta (granular scopes), never from the browser.
 */
export const whatsappOAuthAdapter: OAuthAdapter = {
  slug: "whatsapp",
  providerId: "whatsapp_cloud",
  permission: PERMISSIONS.SOCIAL_CHANNEL_MANAGE,
  cookiePrefix: "cos_wa",
  pickerPath: "/connector/whatsapp",
  deniedCode: "WHATSAPP_DENIED",

  assertConfigured() {
    metaAppConfig();
    if (!/^\d{1,32}$/.test(process.env.META_WA_CONFIG_ID ?? "")) {
      throw new AppError("WHATSAPP_LOGIN_NOT_CONFIGURED", "WhatsApp sign-up isn't set up on this server (META_WA_CONFIG_ID).", 503);
    }
  },

  authorizeUrl({ state, redirectUri, scopes }) {
    const url = new URL(DIALOG_URL);
    url.searchParams.set("client_id", metaAppConfig().appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("config_id", process.env.META_WA_CONFIG_ID ?? "");
    url.searchParams.set("override_default_response_type", "true");
    url.searchParams.set("extras", JSON.stringify({ setup: {}, featureType: "", sessionInfoVersion: "3" }));
    url.searchParams.set("scope", scopes.join(","));
    return url.toString();
  },

  async exchangeCode(code, redirectUri): Promise<TokenSet> {
    const { appId, appSecret } = metaAppConfig();
    // Embedded Signup returns a business integration token, already long-lived: no fb_exchange_token step
    const res = await metaGraph("GET", "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    const token = str(res.access_token);
    if (!token) throw new AppError("META_API_ERROR", "Facebook did not return an access token.", 502);
    return { accessToken: token };
  },

  inspect: (token) => metaOAuthAdapter.inspect(token),
};
