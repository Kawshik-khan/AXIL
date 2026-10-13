/**
 * "Connect with Facebook" (Facebook Login for Business) for one CommerceOS Meta app shared by every workspace.
 *
 * 1. start: a signed, 10-minute `state` bound to the workspace, the user and a nonce that also sits in an httpOnly
 *    cookie, so the round trip can only finish in the browser that began it, for the same signed-in user.
 * 2. callback (GET, writes nothing to the store): checks the state, swaps the code for a long-lived user token and
 *    keeps it encrypted in a short-lived httpOnly cookie. The token never reaches page JavaScript or the store.
 * 3. pages: lists the Pages that token manages (and their linked Instagram accounts), without tokens.
 * 4. connect: for each Page the merchant picked, Page tokens are fetched again from Meta (never taken from the client),
 *    the Page is subscribed to the app's webhooks (feed + messages), and FACEBOOK_MESSENGER / INSTAGRAM channels are
 *    created or refreshed. A Page held by another workspace is refused (audit H5).
 *
 * Every Graph call carries `appsecret_proof`. Nothing is reported connected unless Meta answered.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { randomSuffix } from "@/lib/ids";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError } from "@/lib/errors";
import { decryptCredential, encryptCredential, signMetaOAuthState, verifyMetaOAuthState } from "@/lib/security";
import { outboundRequest, OutboundBlockedError, OutboundNetworkError, OutboundTimeoutError } from "@/lib/outbound-http";
import { ChannelService } from "../channels/channel.service";
import type { ChannelType, ConnectedChannel } from "@/types/social";

export const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const CALL_TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 15 * 60_000;

export const META_NONCE_COOKIE = "cos_meta_oauth";
export const META_PENDING_COOKIE = "cos_meta_pending";
export const META_COOKIE_PATH = "/api/v1/social/meta";

/** What CommerceOS asks for: comments and DMs on Pages and Instagram, and Page selection through Business Manager. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "business_management",
] as const;

/** Page webhook fields the app subscribes each connected Page to (Instagram fields are set on the app). */
export const PAGE_SUBSCRIBED_FIELDS = ["feed", "messages", "messaging_postbacks"] as const;

interface MetaConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

function config(): MetaConfig {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const scheme = process.env.NODE_ENV === "production" ? /^https:\/\// : /^https?:\/\//;
  if (!appId || !appSecret || !scheme.test(appUrl)) {
    throw new AppError("META_LOGIN_NOT_CONFIGURED", "Connect with Facebook isn't set up on this server (META_APP_ID, META_APP_SECRET and APP_URL).", 503);
  }
  return { appId, appSecret, redirectUri: `${appUrl}${META_COOKIE_PATH}/oauth/callback` };
}

/** Where the callback sends the browser back to: APP_URL (validated), not the request's Host header. */
export function appOrigin(fallback: string): string {
  try {
    return new URL(config().redirectUri).origin;
  } catch {
    return fallback;
  }
}

export function metaLoginConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/** The part of a Meta error that is safe to show: short, with anything token-shaped removed. */
function safeError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200);
}

async function graph(
  method: "GET" | "POST",
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
  let res;
  try {
    res = await outboundRequest(`${GRAPH_API}${path}${method === "GET" ? `?${query}` : ""}`, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? query.toString() : undefined,
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

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Meta pages as Meta returned them, with the Page token. Internal only: never sent to the browser. */
interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
  instagram?: { id: string; username?: string };
}

async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const res = await graph("GET", "/me/accounts", {
    fields: "id,name,access_token,tasks,instagram_business_account{id,username}",
    limit: "100",
  }, userToken);
  const rows = Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
  return rows
    .map((r) => {
      const ig = (r.instagram_business_account ?? null) as Record<string, unknown> | null;
      return {
        id: str(r.id),
        name: str(r.name).slice(0, 120) || "Facebook Page",
        accessToken: str(r.access_token),
        tasks: Array.isArray(r.tasks) ? (r.tasks as unknown[]).map(String) : [],
        instagram: ig && str(ig.id) ? { id: str(ig.id), username: str(ig.username) || undefined } : undefined,
      };
    })
    .filter((p) => /^\d{1,32}$/.test(p.id) && p.accessToken);
}

async function missingPermissions(userToken: string): Promise<string[]> {
  const res = await graph("GET", "/me/permissions", {}, userToken);
  const rows = Array.isArray(res.data) ? (res.data as Array<{ permission?: unknown; status?: unknown }>) : [];
  const granted = new Set(rows.filter((r) => r.status === "granted").map((r) => String(r.permission)));
  return META_SCOPES.filter((s) => !granted.has(s));
}

interface PendingLogin {
  t: string;
  u: string;
  token: string;
  exp: number;
}

function readPending(context: RequestContext, cookieValue: string | undefined): PendingLogin {
  if (!cookieValue) throw new AppError("META_LOGIN_REQUIRED", "Connect with Facebook first.", 404);
  let pending: PendingLogin;
  try {
    pending = decryptCredential<PendingLogin>(cookieValue);
  } catch {
    throw new AppError("META_LOGIN_REQUIRED", "Connect with Facebook first.", 404);
  }
  // Bound to the workspace and user that signed in to Facebook; a copied cookie is useless anywhere else
  if (pending.t !== context.tenant.id || pending.u !== context.user.id || typeof pending.token !== "string" || !(pending.exp > Date.now())) {
    throw new AppError("META_LOGIN_REQUIRED", "Your Facebook sign-in expired. Connect again.", 404);
  }
  return pending;
}

export type PageChannelState = "NOT_CONNECTED" | "CONNECTED_HERE" | "IN_ANOTHER_WORKSPACE";

export interface PickablePage {
  id: string;
  name: string;
  can_message: boolean;
  facebook: PageChannelState;
  instagram?: { id: string; username?: string; state: PageChannelState };
}

function channelState(tenantId: string, type: ChannelType, accountId: string): PageChannelState {
  const holders = db.findConnectedChannelsByProviderId(type, accountId);
  if (holders.some((c) => c.tenant_id !== tenantId)) return "IN_ANOTHER_WORKSPACE";
  return holders.length ? "CONNECTED_HERE" : "NOT_CONNECTED";
}

/** CONNECTED_NO_WEBHOOKS: the channel is saved (the token works) but Meta didn't confirm the webhook subscription. */
export type ConnectOutcome = "CONNECTED" | "RECONNECTED" | "CONNECTED_NO_WEBHOOKS" | "IN_ANOTHER_WORKSPACE" | "FAILED" | "SKIPPED";

export interface PageConnectResult {
  page_id: string;
  name: string;
  facebook: ConnectOutcome;
  instagram?: ConnectOutcome;
  instagram_username?: string;
  /** Meta confirmed the Page is subscribed to the app's webhooks (comments and messages will arrive). */
  webhooks_subscribed: boolean;
  error?: string;
}

export class MetaLoginService {
  /** Step 1. Returns the Facebook dialog URL and the nonce the route puts in an httpOnly cookie. */
  public static async start(context: RequestContext): Promise<{ url: string; nonce: string }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const { appId, redirectUri } = config();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const state = await signMetaOAuthState({ tenantId: context.tenant.id, userId: context.user.id, nonce });
    const url = new URL(DIALOG_URL);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_SCOPES.join(","));
    return { url: url.toString(), nonce };
  }

  /**
   * Step 2 (the GET callback; writes nothing to the store). Returns the encrypted pending-login cookie value.
   * Throws AppError with a short code the route turns into a redirect.
   */
  public static async completeCallback(
    context: RequestContext,
    params: { code?: string | null; state?: string | null; error?: string | null },
    nonceCookie: string | undefined
  ): Promise<string> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    if (params.error) throw new AppError("META_DENIED", "Facebook sign-in was cancelled.", 400);
    const state = params.state ? await verifyMetaOAuthState(params.state) : null;
    if (!state || !nonceCookie || !params.code) throw new AppError("META_STATE_INVALID", "The Facebook sign-in link is invalid or expired.", 400);
    const a = Buffer.from(state.nonce);
    const b = Buffer.from(nonceCookie);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError("META_STATE_INVALID", "The Facebook sign-in link is invalid or expired.", 400);
    }
    if (state.tenantId !== context.tenant.id || state.userId !== context.user.id) {
      throw new AppError("META_STATE_INVALID", "The Facebook sign-in was started by another account or workspace.", 400);
    }

    const { appId, appSecret, redirectUri } = config();
    const short = await graph("GET", "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code: params.code });
    const shortToken = str(short.access_token);
    if (!shortToken) throw new AppError("META_API_ERROR", "Facebook did not return an access token.", 502);
    // Page tokens fetched with a long-lived user token don't expire
    const long = await graph("GET", "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken });
    const userToken = str(long.access_token) || shortToken;
    return encryptCredential({ t: context.tenant.id, u: context.user.id, token: userToken, exp: Date.now() + PENDING_TTL_MS });
  }

  /** Step 3. The Pages (and linked Instagram accounts) the merchant can connect. No tokens leave the server. */
  public static async listPages(
    context: RequestContext,
    pendingCookie: string | undefined
  ): Promise<{ pages: PickablePage[]; missing_permissions: string[] }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = readPending(context, pendingCookie);
    const [pages, missing] = await Promise.all([fetchPages(pending.token), missingPermissions(pending.token)]);
    return {
      missing_permissions: missing,
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        can_message: p.tasks.length === 0 || p.tasks.includes("MESSAGING") || p.tasks.includes("MANAGE"),
        facebook: channelState(context.tenant.id, "FACEBOOK_MESSENGER", p.id),
        instagram: p.instagram ? { ...p.instagram, state: channelState(context.tenant.id, "INSTAGRAM", p.instagram.id) } : undefined,
      })),
    };
  }

  /**
   * Step 4. Runs outside the store lock (the route uses `unit: false`): Meta calls first, then one short unit of work
   * per Page saves its channels.
   */
  public static async connectPages(
    context: RequestContext,
    pendingCookie: string | undefined,
    input: { page_ids: string[]; include_instagram: boolean }
  ): Promise<PageConnectResult[]> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = readPending(context, pendingCookie);
    const wanted = new Set(input.page_ids);
    // Tokens come from Meta for pages this Facebook user manages; an id the user doesn't manage is simply not found
    const pages = (await fetchPages(pending.token)).filter((p) => wanted.has(p.id));
    if (pages.length === 0) throw new BadRequestError("None of the selected Pages are managed by this Facebook account.");

    const results: PageConnectResult[] = [];
    for (const page of pages) {
      const result: PageConnectResult = { page_id: page.id, name: page.name, facebook: "SKIPPED", webhooks_subscribed: false };
      if (page.instagram) result.instagram_username = page.instagram.username;
      if (channelState(context.tenant.id, "FACEBOOK_MESSENGER", page.id) === "IN_ANOTHER_WORKSPACE") {
        result.facebook = "IN_ANOTHER_WORKSPACE";
        result.error = "This Page is connected to another CommerceOS workspace.";
        results.push(result);
        continue;
      }
      try {
        const sub = await graph("POST", `/${page.id}/subscribed_apps`, { subscribed_fields: PAGE_SUBSCRIBED_FIELDS.join(",") }, page.accessToken);
        result.webhooks_subscribed = sub.success === true;
        if (!result.webhooks_subscribed) result.error = "Facebook didn't confirm the webhook subscription.";
      } catch (err) {
        result.error = `Webhooks not subscribed: ${err instanceof Error ? err.message : "Facebook refused."} Comments and messages won't arrive until this works.`;
      }

      const webhookError = result.webhooks_subscribed ? undefined : "Meta hasn't confirmed the webhook subscription; comments and messages may not arrive. Connect again.";
      await db.unit(async () => {
        result.facebook = await this.upsertChannel(context, "FACEBOOK_MESSENGER", page.id, page.name, page, webhookError);
        if (page.instagram && input.include_instagram) {
          const igName = page.instagram.username ? `@${page.instagram.username}` : `${page.name} (Instagram)`;
          result.instagram = channelState(context.tenant.id, "INSTAGRAM", page.instagram.id) === "IN_ANOTHER_WORKSPACE"
            ? "IN_ANOTHER_WORKSPACE"
            : await this.upsertChannel(context, "INSTAGRAM", page.instagram.id, igName, page, webhookError);
        }
        db.createAuditLog({
          id: `aud_${Date.now()}_${randomSuffix()}`,
          tenant_id: context.tenant.id,
          actor_user_id: context.user.id,
          action: "social.channel.meta_connected",
          resource_type: "connected_channel",
          resource_id: page.id,
          metadata: { page_id: page.id, facebook: result.facebook, instagram: result.instagram ?? "NONE", webhooks_subscribed: result.webhooks_subscribed },
          created_at: new Date().toISOString(),
        });
        return true;
      }, () => true).catch((err: unknown) => {
        result.facebook = result.facebook === "SKIPPED" ? "FAILED" : result.facebook;
        // Store errors can name internal ids: show a fixed message, log the detail
        result.error = err instanceof AppError ? err.message : "Could not save the channel. Try again.";
        logger.warn("meta_login.save_failed", { tenant_id: context.tenant.id, page_id: page.id, error: err instanceof Error ? err.message : "error" });
      });
      logger.info("meta_login.page_connected", {
        tenant_id: context.tenant.id,
        page_id: page.id,
        facebook: result.facebook,
        instagram: result.instagram ?? "NONE",
        webhooks_subscribed: result.webhooks_subscribed,
      });
      results.push(result);
    }
    return results;
  }

  private static async upsertChannel(
    context: RequestContext,
    type: "FACEBOOK_MESSENGER" | "INSTAGRAM",
    accountId: string,
    name: string,
    page: MetaPage,
    webhookError?: string
  ): Promise<ConnectOutcome> {
    const credentials = { accessToken: page.accessToken, pageId: page.id, connectedVia: "facebook_login", connectedBy: context.user.id };
    const existing = db.findConnectedChannelsByProviderId(type, accountId).find((c) => c.tenant_id === context.tenant.id);
    const now = new Date().toISOString();
    if (existing) {
      db.updateConnectedChannel(context.tenant.id, existing.id, {
        name,
        status: "ACTIVE",
        external_page_id: page.id,
        credentials_encrypted: encryptCredential(credentials),
        connector_id: undefined,
        error_message: webhookError,
        last_sync_at: now,
        updated_at: now,
      } as Partial<ConnectedChannel>);
      return webhookError ? "CONNECTED_NO_WEBHOOKS" : "RECONNECTED";
    }
    const created = await ChannelService.connectChannel(context, {
      type,
      name,
      provider_account_id: accountId,
      external_page_id: page.id,
      credentials,
      // Automatic replies stay off until the merchant turns them on
      configuration: { auto_reply_enabled: false },
    });
    if (webhookError) {
      db.updateConnectedChannel(context.tenant.id, created.id, { error_message: webhookError });
      return "CONNECTED_NO_WEBHOOKS";
    }
    return "CONNECTED";
  }
}

/**
 * A pasted Page token must belong to the account it is connected as (one shared Meta app signs every Page's webhooks,
 * so a bare Page id would let a workspace receive another shop's messages). For a Page token, `/me` is the Page itself;
 * for Instagram it is the Page linked to that Instagram business account.
 */
export async function verifyMetaAccountOwnership(type: "FACEBOOK_MESSENGER" | "INSTAGRAM", accountId: string, token: string): Promise<void> {
  if (!token) throw new BadRequestError("A Page access token is required.");
  let me: Record<string, unknown>;
  try {
    me = await graph("GET", "/me", { fields: type === "INSTAGRAM" ? "id,instagram_business_account{id}" : "id" }, token);
  } catch (err) {
    if (err instanceof AppError && err.code === "META_UNREACHABLE") throw err;
    throw new BadRequestError("Facebook didn't accept this access token for the account. Use Connect with Facebook instead.");
  }
  const ig = (me.instagram_business_account ?? {}) as Record<string, unknown>;
  const owned = type === "INSTAGRAM" ? str(ig.id) === accountId : str(me.id) === accountId;
  if (!owned) throw new BadRequestError("This access token doesn't belong to that Page or Instagram account.");
}

/** Reads one cookie from a request. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function metaCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, // sent on the top-level redirect back from facebook.com
    path: META_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}
