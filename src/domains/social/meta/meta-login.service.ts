/**
 * "Connect with Facebook": the Meta resource picker on top of the OAuth broker (ADR-119 P1,
 * src/domains/connectors/auth/oauth-broker.ts), which owns the state, nonce, cookies and the connection record.
 *
 * 1. start / callback: delegated to the broker (provider slug "meta"); the callback writes nothing to the store.
 * 2. pages: lists the Pages the signed-in token manages (and their linked Instagram accounts) and its ad accounts,
 *    without tokens.
 * 3. connect: the broker saves the connection (owner, granted scopes, expiry, the one copy of the user token); then for
 *    each Page the merchant picked, Page tokens are fetched again from Meta (never taken from the client), the Page is
 *    subscribed to the app's webhooks (feed + messages), and FACEBOOK_MESSENGER / INSTAGRAM channels are created or
 *    refreshed. Each Page / Instagram account is saved as a resource of the connection (holding the Page token) and
 *    its channel points at it. A Page held by another workspace is refused (audit H5). A picked ad account (checked
 *    with Meta again) becomes the workspace's AD_ACCOUNT resource, which Ad Manager reads with the connection's token.
 *
 * Every Graph call carries `appsecret_proof`. Nothing is reported connected unless Meta answered.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { randomSuffix } from "@/lib/ids";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError } from "@/lib/errors";
import { encryptCredential } from "@/lib/security";
import { ChannelService } from "../channels/channel.service";
import { bindAdAccount, upsertConnectionResource } from "@/domains/connectors/resources";
import { normalizeAdAccountId } from "../insights/meta-graph-reader";
import { metaGraph as graph, metaOAuthAdapter } from "@/domains/connectors/auth/meta.adapter";
import {
  OAuthBroker,
  OAUTH_COOKIE_PATH,
  appOrigin as brokerAppOrigin,
  nonceCookieName,
  oauthCookieOptions,
  pendingCookieName,
  scopesFor,
} from "@/domains/connectors/auth/oauth-broker";
import type { ChannelType, ConnectedChannel } from "@/types/social";

export { GRAPH_VERSION } from "@/domains/connectors/auth/meta.adapter";

const META = metaOAuthAdapter.slug;
export const META_NONCE_COOKIE = nonceCookieName(metaOAuthAdapter);
export const META_PENDING_COOKIE = pendingCookieName(metaOAuthAdapter);
export const META_COOKIE_PATH = OAUTH_COOKIE_PATH;
/** The optional feature whose extra scope (`ads_read`) is asked only when the merchant connects Ad Manager (ADR-119 E5). */
export const ADS_FEATURE = "ads";

/** Page webhook fields the app subscribes each connected Page to (Instagram fields are set on the app). */
export const PAGE_SUBSCRIBED_FIELDS = ["feed", "messages", "messaging_postbacks"] as const;

/** Where the callback sends the browser back to: APP_URL (validated), not the request's Host header. */
export function appOrigin(fallback: string): string {
  return brokerAppOrigin(metaOAuthAdapter, fallback);
}

export const metaCookieOptions = oauthCookieOptions;

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

/** An ad account the Facebook user can read (Ad Manager). Listed to the browser: ids and names only, no token. */
export interface PickableAdAccount {
  id: string;
  name: string;
  currency: string;
  active: boolean;
}

async function fetchAdAccounts(userToken: string): Promise<PickableAdAccount[]> {
  let res: Record<string, unknown>;
  try {
    res = await graph("GET", "/me/adaccounts", { fields: "account_id,name,currency,account_status", limit: "100" }, userToken);
  } catch (err) {
    // ads_read not granted: no ad accounts to offer (missing_permissions says why)
    if (err instanceof AppError && err.code === "META_PERMISSION_DENIED") return [];
    throw err;
  }
  const rows = Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
  return rows
    .map((r) => {
      const id = normalizeAdAccountId(str(r.account_id) || str(r.id));
      return { id, name: str(r.name).slice(0, 120) || `Ad account ${id}`, currency: str(r.currency).slice(0, 8), active: r.account_status === 1 };
    })
    .filter((a) => a.id);
}

async function grantedPermissions(userToken: string): Promise<Set<string>> {
  const res = await graph("GET", "/me/permissions", {}, userToken);
  const rows = Array.isArray(res.data) ? (res.data as Array<{ permission?: unknown; status?: unknown }>) : [];
  return new Set(rows.filter((r) => r.status === "granted").map((r) => String(r.permission)));
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
  const kind = type === "INSTAGRAM" ? "IG_ACCOUNT" : "FB_PAGE";
  if (holders.some((c) => c.tenant_id !== tenantId)) return "IN_ANOTHER_WORKSPACE";
  if (db.findLiveConnectionResourcesByExternalId(kind, accountId).some((r) => r.tenant_id !== tenantId)) return "IN_ANOTHER_WORKSPACE";
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
  /**
   * Step 1. Returns the Facebook dialog URL and the nonce the route puts in an httpOnly cookie. A plain sign-in asks only
   * the Page and Instagram scopes; `["ads"]` also asks `ads_read` (Ad Manager's "Connect ads").
   */
  public static async start(context: RequestContext, features: string[] = []): Promise<{ url: string; nonce: string }> {
    return OAuthBroker.start(context, META, features);
  }

  /**
   * Step 2 (the GET callback; writes nothing to the store). Returns the encrypted pending-sign-in cookie value.
   * Throws AppError with a short code the route turns into a redirect.
   */
  public static async completeCallback(
    context: RequestContext,
    params: { code?: string | null; state?: string | null; error?: string | null },
    nonceCookie: string | undefined
  ): Promise<string> {
    return OAuthBroker.completeCallback(context, META, params, nonceCookie);
  }

  /**
   * Step 3. The Pages (and linked Instagram accounts) the merchant can connect, and, when the sign-in asked for Ad
   * Manager, the ad accounts. No tokens leave the server. `missing_permissions` lists only required scopes; an optional
   * one the merchant declined shows in `ads.granted: false`.
   */
  public static async listPages(
    context: RequestContext,
    pendingCookie: string | undefined
  ): Promise<{
    pages: PickablePage[];
    ad_accounts: PickableAdAccount[];
    missing_permissions: string[];
    ads: { requested: boolean; granted: boolean };
  }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = OAuthBroker.readPending(context, META, pendingCookie);
    const userToken = pending.token.accessToken;
    const adsRequested = pending.features.includes(ADS_FEATURE);
    const [pages, granted] = await Promise.all([fetchPages(userToken), grantedPermissions(userToken)]);
    const adsGranted = scopesFor(metaOAuthAdapter, [ADS_FEATURE])
      .filter((s) => !scopesFor(metaOAuthAdapter, []).includes(s))
      .every((s) => granted.has(s));
    // Ad accounts are listed only when the merchant asked to connect Ad Manager
    const adAccounts = adsRequested && adsGranted ? await fetchAdAccounts(userToken) : [];
    return {
      missing_permissions: scopesFor(metaOAuthAdapter, []).filter((s) => !granted.has(s)),
      ads: { requested: adsRequested, granted: adsGranted },
      ad_accounts: adAccounts,
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
    input: { page_ids: string[]; include_instagram: boolean; ad_account_id?: string }
  ): Promise<PageConnectResult[]> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = OAuthBroker.readPending(context, META, pendingCookie);
    const userToken = pending.token.accessToken;
    if (input.page_ids.length === 0 && !input.ad_account_id) throw new BadRequestError("Pick a Page or an ad account.");
    const wanted = new Set(input.page_ids);
    // Tokens come from Meta for pages this Facebook user manages; an id the user doesn't manage is simply not found.
    // "Connect ads" may pick only an ad account (no Pages).
    const pages = input.page_ids.length ? (await fetchPages(userToken)).filter((p) => wanted.has(p.id)) : [];
    if (input.page_ids.length && pages.length === 0) throw new BadRequestError("None of the selected Pages are managed by this Facebook account.");

    // The ad account must be one this Facebook user can read (asked of Meta again, never trusted from the client)
    let account: PickableAdAccount | undefined;
    if (input.ad_account_id) {
      const wantedAd = normalizeAdAccountId(input.ad_account_id);
      account = (await fetchAdAccounts(userToken)).find((a) => a.id === wantedAd);
      if (!account) throw new BadRequestError("That ad account isn't available to this Facebook account.");
    }

    // The connection: the one stored copy of the user token, with its owner, granted scopes and expiry (ADR-119)
    const connection = await OAuthBroker.saveConnection(context, META, pending);

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
        result.facebook = await this.activatePage(context, connection.id, "FACEBOOK_MESSENGER", page.id, page.name, page, webhookError);
        if (page.instagram && input.include_instagram) {
          const igName = page.instagram.username ? `@${page.instagram.username}` : `${page.name} (Instagram)`;
          result.instagram = channelState(context.tenant.id, "INSTAGRAM", page.instagram.id) === "IN_ANOTHER_WORKSPACE"
            ? "IN_ANOTHER_WORKSPACE"
            : await this.activatePage(context, connection.id, "INSTAGRAM", page.instagram.id, igName, page, webhookError, page.instagram.username);
        }
        db.createAuditLog({
          id: `aud_${Date.now()}_${randomSuffix()}`,
          tenant_id: context.tenant.id,
          actor_user_id: context.user.id,
          action: "social.channel.meta_connected",
          resource_type: "connected_channel",
          resource_id: page.id,
          metadata: {
            page_id: page.id,
            facebook: result.facebook,
            instagram: result.instagram ?? "NONE",
            webhooks_subscribed: result.webhooks_subscribed,
            connection_id: connection.id,
          },
          created_at: new Date().toISOString(),
        });
        return true;
      }, () => true).catch((err: unknown) => {
        // The unit didn't commit, so nothing for this Page was saved, whatever the steps before the error returned
        result.facebook = "FAILED";
        if (page.instagram && input.include_instagram && result.instagram !== "IN_ANOTHER_WORKSPACE") result.instagram = "FAILED";
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

    // The picked ad account becomes Ad Manager's account; reconnecting without a pick keeps the current one
    if (account) {
      const picked = account;
      await db.unit(async () => {
        const resource = upsertConnectionResource(context.tenant.id, connection.id, "AD_ACCOUNT", picked.id, {
          name: picked.name,
          metadata: picked.currency ? { currency: picked.currency } : {},
          status: "ACTIVE",
          activated: true,
        });
        const replaced = bindAdAccount(context.tenant.id, resource.id);
        db.createAuditLog({
          id: `aud_${Date.now()}_${randomSuffix()}`,
          tenant_id: context.tenant.id,
          actor_user_id: context.user.id,
          action: "connection.ad_account_bound",
          resource_type: "connection_resource",
          resource_id: resource.id,
          metadata: { ad_account_id: picked.id, connection_id: connection.id, replaced_ad_account_ids: replaced.join(",") || "NONE" },
          created_at: new Date().toISOString(),
        });
        return true;
      }, () => true);
    }
    return results;
  }

  /**
   * Saves the Page (or its Instagram account) as a resource of the connection, holding the Page token, and creates or
   * refreshes its channel pointing at that resource. The channel keeps a copy of the Page token for one release so a
   * rollback still works (ADR-119 E3).
   */
  private static async activatePage(
    context: RequestContext,
    connectionId: string,
    type: "FACEBOOK_MESSENGER" | "INSTAGRAM",
    accountId: string,
    name: string,
    page: MetaPage,
    webhookError?: string,
    username?: string
  ): Promise<ConnectOutcome> {
    const resource = upsertConnectionResource(context.tenant.id, connectionId, type === "INSTAGRAM" ? "IG_ACCOUNT" : "FB_PAGE", accountId, {
      name,
      metadata: type === "INSTAGRAM" ? { page_id: page.id, ...(username ? { username } : {}) } : {},
      token: page.accessToken,
      status: webhookError ? "NEEDS_ATTENTION" : "ACTIVE",
      activated: !webhookError,
    });
    const existing = db.findConnectedChannelsByProviderId(type, accountId).find((c) => c.tenant_id === context.tenant.id);
    // An ad account picked before resources existed stays readable until the migration moves it (no token is kept here)
    let legacyAds: Record<string, string> = {};
    if (existing) {
      try {
        const old = ChannelService.getDecryptedCredentials(existing);
        for (const key of ["adAccountId", "adAccountName", "adsConnectionId"] as const) {
          if (typeof old[key] === "string" && old[key]) legacyAds = { ...legacyAds, [key]: old[key] as string };
        }
      } catch {
        // unreadable old credentials: nothing to keep
      }
    }
    const credentials = {
      accessToken: page.accessToken,
      pageId: page.id,
      connectedVia: "facebook_login",
      connectedBy: context.user.id,
      ...legacyAds,
    };
    const now = new Date().toISOString();
    if (existing) {
      db.updateConnectedChannel(context.tenant.id, existing.id, {
        name,
        status: "ACTIVE",
        external_page_id: page.id,
        credentials_encrypted: encryptCredential(credentials),
        connector_id: undefined,
        resource_id: resource.id,
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
      // Automatic replies are on for a newly connected page; the merchant can turn them off per channel
      configuration: { auto_reply_enabled: true },
    });
    db.updateConnectedChannel(context.tenant.id, created.id, { resource_id: resource.id, ...(webhookError ? { error_message: webhookError } : {}) });
    return webhookError ? "CONNECTED_NO_WEBHOOKS" : "CONNECTED";
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
