/**
 * OAuth broker for provider sign-in (ADR-119 E6, docs/connection-platform-plan.md P1).
 *
 * 1. start: a signed, 10-minute `state` bound to the workspace, the user, the provider, the requested features and a
 *    nonce that also sits in an httpOnly cookie, so the round trip can only finish in the browser that began it.
 * 2. callback (GET, writes nothing to the store): checks the state, swaps the code for a token and keeps it encrypted in a
 *    short-lived httpOnly cookie. The token never reaches page JavaScript.
 * 3. activate (POST, by the provider's resource picker): asks the provider who the token belongs to, then creates or
 *    refreshes the connection (`connector_configurations` row): one per workspace and provider account, with its owner,
 *    the scopes the provider granted and the expiry.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { randomSuffix } from "@/lib/ids";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { AppError, BadRequestError, NotFoundError } from "@/lib/errors";
import { decryptCredential, encryptCredential, maskSecret, signOAuthState, verifyOAuthState } from "@/lib/security";
import { PROVIDER_MANIFESTS } from "@/domains/connectors/manifests";
import type { ConnectorConfigRecord, ConnectorProviderDefinition } from "@/types/connector";
import { metaOAuthAdapter, whatsappOAuthAdapter } from "./meta.adapter";
import type { OAuthAdapter, TokenSet } from "./types";

const PENDING_TTL_MS = 15 * 60_000;
/** Sent only to the sign-in routes (/api/v1/connections/*). */
export const OAUTH_COOKIE_PATH = "/api/v1/connections";

const ADAPTERS: Record<string, OAuthAdapter> = {
  [metaOAuthAdapter.slug]: metaOAuthAdapter,
  [whatsappOAuthAdapter.slug]: whatsappOAuthAdapter,
};

/** The sign-in adapter for a provider (manifest id), if it is connected by signing in through this broker. */
export function oauthAdapterForProvider(providerId: string): OAuthAdapter | undefined {
  return Object.values(ADAPTERS).find((a) => a.providerId === providerId);
}

/** True when the provider (manifest id) is connected by signing in through this broker. */
export function hasOAuthAdapter(providerId: string): boolean {
  return oauthAdapterForProvider(providerId) !== undefined;
}

export function getOAuthAdapter(slug: string): OAuthAdapter {
  const adapter = Object.prototype.hasOwnProperty.call(ADAPTERS, slug) ? ADAPTERS[slug] : undefined;
  if (!adapter) throw new NotFoundError("Provider sign-in");
  return adapter;
}

function manifestOf(adapter: OAuthAdapter): ConnectorProviderDefinition {
  const manifest = PROVIDER_MANIFESTS.find((p) => p.id === adapter.providerId);
  if (!manifest) throw new AppError("PROVIDER_NOT_SUPPORTED", "This provider isn't in the catalog.", 404);
  return manifest;
}

export function nonceCookieName(adapter: OAuthAdapter): string {
  return `${adapter.cookiePrefix}_oauth`;
}

export function pendingCookieName(adapter: OAuthAdapter): string {
  return `${adapter.cookiePrefix}_pending`;
}

export function oauthCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, // sent on the top-level redirect back from the provider
    path: OAUTH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

/** APP_URL, validated (https in production). The redirect URI never comes from the request's Host header. */
function appUrl(adapter: OAuthAdapter): string {
  const url = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const scheme = process.env.NODE_ENV === "production" ? /^https:\/\// : /^https?:\/\//;
  if (!scheme.test(url)) {
    throw new AppError(`${adapter.slug.toUpperCase()}_LOGIN_NOT_CONFIGURED`, "Sign-in isn't set up on this server (APP_URL).", 503);
  }
  return url;
}

export function redirectUriFor(adapter: OAuthAdapter): string {
  return `${appUrl(adapter)}/api/v1/connections/${adapter.slug}/callback`;
}

/** Where the callback sends the browser back to: APP_URL's origin, or the fallback when it isn't set. */
export function appOrigin(adapter: OAuthAdapter, fallback: string): string {
  try {
    return new URL(appUrl(adapter)).origin;
  } catch {
    return fallback;
  }
}

/** The manifest's base scopes plus those of each requested optional feature. An unknown feature is refused. */
export function scopesFor(adapter: OAuthAdapter, features: string[]): string[] {
  const manifest = manifestOf(adapter);
  const scopes = new Set(manifest.base_scopes ?? []);
  for (const feature of features) {
    const optional = (manifest.optional_scopes ?? []).find((o) => o.feature === feature);
    if (!optional) throw new BadRequestError(`Unknown feature '${feature}' for this provider.`);
    for (const scope of optional.scopes) scopes.add(scope);
  }
  return [...scopes];
}

type PendingLogin = {
  t: string;
  u: string;
  p: string;
  f: string[];
  token: string;
  exp: number;
};

export interface PendingSignIn {
  token: TokenSet;
  features: string[];
}

export class OAuthBroker {
  /** Step 1. Returns the provider's dialog URL and the nonce the route puts in an httpOnly cookie. */
  public static async start(context: RequestContext, slug: string, features: string[] = []): Promise<{ url: string; nonce: string }> {
    const adapter = getOAuthAdapter(slug);
    RbacService.assertCan(context, adapter.permission);
    adapter.assertConfigured();
    const scopes = scopesFor(adapter, features);
    const nonce = crypto.randomBytes(24).toString("base64url");
    const state = await signOAuthState({ tenantId: context.tenant.id, userId: context.user.id, nonce, provider: adapter.slug, features });
    return { url: adapter.authorizeUrl({ state, redirectUri: redirectUriFor(adapter), scopes }), nonce };
  }

  /**
   * Step 2 (the GET callback; writes nothing to the store). Returns the encrypted pending-sign-in cookie value.
   * Throws AppError with a short code the route turns into a redirect.
   */
  public static async completeCallback(
    context: RequestContext,
    slug: string,
    params: { code?: string | null; state?: string | null; error?: string | null },
    nonceCookie: string | undefined
  ): Promise<string> {
    const adapter = getOAuthAdapter(slug);
    RbacService.assertCan(context, adapter.permission);
    const deniedPrefix = adapter.deniedCode.replace(/_DENIED$/, "");
    if (params.error) throw new AppError(adapter.deniedCode, "Sign-in was cancelled.", 400);
    const invalid = new AppError(`${deniedPrefix}_STATE_INVALID`, "The sign-in link is invalid or expired.", 400);
    const state = params.state ? await verifyOAuthState(params.state) : null;
    if (!state || !nonceCookie || !params.code || state.provider !== adapter.slug) throw invalid;
    const a = Buffer.from(state.nonce);
    const b = Buffer.from(nonceCookie);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw invalid;
    if (state.tenantId !== context.tenant.id || state.userId !== context.user.id) {
      throw new AppError(`${deniedPrefix}_STATE_INVALID`, "The sign-in was started by another account or workspace.", 400);
    }
    const token = await adapter.exchangeCode(params.code, redirectUriFor(adapter));
    const pending: PendingLogin = {
      t: context.tenant.id,
      u: context.user.id,
      p: adapter.slug,
      f: state.features,
      token: token.accessToken,
      exp: Date.now() + PENDING_TTL_MS,
    };
    return encryptCredential(pending);
  }

  /** The signed-in token waiting for the picker. Bound to the workspace, user and provider; a copied cookie is useless. */
  public static readPending(context: RequestContext, slug: string, cookieValue: string | undefined): PendingSignIn {
    const adapter = getOAuthAdapter(slug);
    const prefix = adapter.deniedCode.replace(/_DENIED$/, "");
    const required = (message: string) => new AppError(`${prefix}_LOGIN_REQUIRED`, message, 404);
    if (!cookieValue) throw required("Connect first.");
    let pending: PendingLogin;
    try {
      pending = decryptCredential<PendingLogin>(cookieValue);
    } catch {
      throw required("Connect first.");
    }
    if (
      pending.t !== context.tenant.id ||
      pending.u !== context.user.id ||
      pending.p !== adapter.slug ||
      typeof pending.token !== "string" ||
      !Array.isArray(pending.f) ||
      !(pending.exp > Date.now())
    ) {
      throw required("Your sign-in expired. Connect again.");
    }
    return { token: { accessToken: pending.token }, features: pending.f };
  }

  /**
   * Step 3. Asks the provider about the token (outside any store unit), then creates or refreshes this workspace's
   * connection for that provider account in one unit of work. Call from a route with `unit: false`.
   */
  public static async saveConnection(context: RequestContext, slug: string, pending: PendingSignIn): Promise<ConnectorConfigRecord> {
    const adapter = getOAuthAdapter(slug);
    RbacService.assertCan(context, adapter.permission);
    const manifest = manifestOf(adapter);
    const inspection = await adapter.inspect(pending.token);
    const missing = scopesFor(adapter, pending.features).filter((s) => !inspection.scopes.includes(s));

    let saved: ConnectorConfigRecord | undefined;
    await db.unit(async () => {
      const existing = db
        .getConnectors(context.tenant.id)
        .find((c) => c.provider_id === adapter.providerId && c.auth_method === "oauth2" && c.external_account_id === inspection.externalAccountId);
      const now = new Date().toISOString();
      const record: ConnectorConfigRecord = {
        id: existing?.id ?? `conn_${adapter.providerId}_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        provider_id: adapter.providerId,
        category: manifest.category,
        name: existing?.name ?? `${manifest.name} (sign-in)`,
        credentials_encrypted: encryptCredential({ access_token: pending.token.accessToken, kind: "user" }),
        credentials_masked: { access_token: maskSecret(pending.token.accessToken) },
        configuration: existing?.configuration ?? {},
        status: "ACTIVE",
        // The provider just answered for this token
        health_status: "HEALTHY",
        capabilities: manifest.capabilities,
        external_account_id: inspection.externalAccountId,
        verified_at: now,
        last_success_at: now,
        enabled: true,
        auth_method: "oauth2",
        owner_user_id: context.user.id,
        scopes_granted: inspection.scopes,
        token_expires_at: inspection.expiresAt,
        connection_status: "ACTIVE",
        health_checked_at: now,
        health_code: missing.length ? "SCOPES_MISSING" : undefined,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      saved = db.saveConnector(record);
      db.createAuditLog({
        id: `aud_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        actor_user_id: context.user.id,
        action: existing ? "connection.refreshed" : "connection.connected",
        resource_type: "connector_configuration",
        resource_id: record.id,
        metadata: {
          provider: adapter.providerId,
          external_account_id: inspection.externalAccountId,
          scopes_granted: inspection.scopes.join(","),
          scopes_missing: missing.join(","),
          token_expires_at: inspection.expiresAt ?? "NEVER",
        },
        created_at: now,
      });
      return true;
    }, () => true);
    if (!saved) throw new AppError("CONNECTION_SAVE_FAILED", "Could not save the connection. Try again.", 500);
    return saved;
  }

  /**
   * The token a feature may use: an enabled sign-in connection that is ACTIVE or DEGRADED (expiring soon) and not past
   * its expiry. Otherwise "" (decrypted in memory only).
   */
  public static connectionToken(connection: ConnectorConfigRecord, now = Date.now()): string {
    if (connection.auth_method !== "oauth2" || connection.enabled === false) return "";
    if (connection.connection_status !== "ACTIVE" && connection.connection_status !== "DEGRADED") return "";
    if (connection.token_expires_at && Date.parse(connection.token_expires_at) <= now) return "";
    return this.storedToken(connection);
  }

  /** The stored token whatever the connection's status (health checks only), or "". */
  public static storedToken(connection: ConnectorConfigRecord): string {
    if (connection.auth_method !== "oauth2") return "";
    try {
      const raw = decryptCredential<Record<string, unknown>>(connection.credentials_encrypted);
      return typeof raw.access_token === "string" ? raw.access_token : "";
    } catch {
      return "";
    }
  }
}
