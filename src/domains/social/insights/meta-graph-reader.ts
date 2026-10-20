/**
 * Read-only Meta Graph client for content and ad insights (Engagement Analysis, Ad Manager).
 *
 * Credentials come from the tenant's Meta Graph connector (Connector Hub) or, failing that, from a connected Facebook
 * Messenger / Instagram channel. Nothing here writes to the store, so the GET routes that use it stay read-only
 * (non-negotiable 9). Every call goes through outboundRequest (ADR-110) to graph.facebook.com only.
 */

import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { decryptCredential } from "@/lib/security";
import { outboundRequest, OutboundBlockedError, OutboundTimeoutError, OutboundNetworkError } from "@/lib/outbound-http";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { resolveAdsAccess } from "@/domains/connectors/resources";

export const GRAPH_HOST = "graph.facebook.com";
export const GRAPH_API = `https://${GRAPH_HOST}/v21.0`;
const CALL_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface MetaReadCredentials {
  source: "CONNECTOR" | "CHANNEL";
  pageId: string;
  pageToken: string;
  instagramUserId: string;
  adAccountId: string;
  adsToken: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** "act_123", "123" -> "123"; anything that is not digits -> "". */
export function normalizeAdAccountId(raw: string): string {
  const digits = raw.trim().replace(/^act_/i, "");
  return /^\d{5,25}$/.test(digits) ? digits : "";
}

/** The tenant's Meta credentials for reading insights, or null when nothing is connected. Never throws for "not set up". */
export function resolveMetaReadCredentials(tenantId: string): MetaReadCredentials | null {
  // A manual connector (pasted tokens). A sign-in connection (auth_method oauth2) holds a user token, not a Page
  // token, and is reached through the channels below.
  const connector = db.getConnectors(tenantId).find((c) => c.provider_id === "meta_graph" && c.auth_method !== "oauth2");
  if (connector && connector.enabled !== false) {
    try {
      const raw = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted);
      const pageToken = str(raw.page_access_token) || str(raw.access_token);
      const adsToken = str(raw.ads_access_token) || pageToken;
      const creds: MetaReadCredentials = {
        source: "CONNECTOR",
        pageId: str(raw.page_id),
        pageToken,
        instagramUserId: str(raw.instagram_account_id),
        adAccountId: normalizeAdAccountId(str(raw.ad_account_id)),
        adsToken,
      };
      if (creds.pageToken || creds.adsToken) return creds;
    } catch {
      // unreadable connector: fall through to the channels
    }
  }

  const channels = db.getConnectedChannels(tenantId);
  const facebook = channels.find((c) => c.type === "FACEBOOK_MESSENGER" && c.status === "ACTIVE");
  const instagram = channels.find((c) => c.type === "INSTAGRAM" && c.status === "ACTIVE");
  if (!facebook && !instagram) return null;
  let pageId = "";
  let pageToken = "";
  let adAccountId = "";
  let adsToken = "";
  // The ad account's token: the sign-in connection named on the channel (tenant-scoped lookup), or a token stored on the
  // channel by the first ad-account release
  const adsTokenOf = (creds: Record<string, unknown>): string => {
    const connectionId = str(creds.adsConnectionId);
    if (connectionId) {
      const connection = db.findConnectorById(tenantId, connectionId);
      return connection ? OAuthBroker.connectionToken(connection) : "";
    }
    return str(creds.adsToken);
  };
  try {
    if (facebook) {
      const creds = ChannelService.getDecryptedCredentials(facebook);
      pageId = str(creds.pageId) || facebook.external_page_id || facebook.provider_account_id;
      pageToken = str(creds.accessToken);
      adAccountId = normalizeAdAccountId(str(creds.adAccountId));
      adsToken = adsTokenOf(creds);
    }
    if ((!pageToken || !adAccountId) && instagram) {
      const creds = ChannelService.getDecryptedCredentials(instagram);
      pageToken = pageToken || str(creds.accessToken);
      if (!adAccountId) {
        adAccountId = normalizeAdAccountId(str(creds.adAccountId));
        adsToken = adsTokenOf(creds);
      }
    }
  } catch {
    return null;
  }
  // The workspace's bound ad account (ADR-119) wins over an ad account recorded on a channel before resources existed
  const access = resolveAdsAccess(tenantId);
  const hasAdResource = db.getConnectionResources(tenantId).some((r) => r.kind === "AD_ACCOUNT" && r.status !== "DETACHED");
  if (access) {
    adAccountId = access.adAccountId;
    adsToken = access.adsToken;
  } else if (hasAdResource) {
    // The bound ad account's connection can't be used (disabled, expired, needs sign-in): reconnect, don't fall back
    adAccountId = "";
    adsToken = "";
  }
  if (!pageToken) return null;
  return {
    source: "CHANNEL",
    pageId,
    pageToken,
    instagramUserId: instagram?.provider_account_id ?? "",
    // Picked during Connect with Facebook; the connection's user token (ads_read) reads the ad account
    adAccountId: adsToken ? adAccountId : "",
    adsToken: adAccountId ? adsToken : "",
  };
}

/** The part of a Meta error message that is safe to show: short, with anything token-shaped removed. */
function safeError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "request failed";
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 200);
}

/** A Meta "invalid parameter" (code 100): an insights metric this object or API version does not support. */
export class MetaInvalidParameterError extends AppError {
  constructor(message: string) {
    super("META_INVALID_PARAMETER", message, 400);
  }
}

export type GraphJson = Record<string, unknown>;

/** GET a Graph path (or a paging.next URL on graph.facebook.com) and return the parsed body. */
export async function graphGet(pathOrUrl: string, params: Record<string, string>, token: string, signal?: AbortSignal): Promise<GraphJson> {
  if (!token) throw new AppError("META_NOT_CONNECTED", "Meta is not connected. Open Connectors and Connect with Facebook.", 424);
  let url: URL;
  if (/^https:\/\//.test(pathOrUrl)) {
    url = new URL(pathOrUrl);
    if (url.hostname !== GRAPH_HOST) throw new AppError("META_API_ERROR", "Refused a paging link outside graph.facebook.com.", 502);
    url.searchParams.delete("access_token");
  } else {
    url = new URL(`${GRAPH_API}${pathOrUrl}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }

  let res;
  try {
    res = await outboundRequest(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: CALL_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      signal,
    });
  } catch (err) {
    if (err instanceof OutboundBlockedError || err instanceof OutboundTimeoutError || err instanceof OutboundNetworkError) {
      throw new AppError("META_UNREACHABLE", "Meta could not be reached. Try again in a minute.", 502);
    }
    throw err;
  }

  let parsed: GraphJson & { error?: { code?: number; message?: string } } = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {
    // not JSON: handled below
  }
  if (res.status >= 200 && res.status < 300 && !parsed.error) return parsed;

  const code = parsed.error?.code ?? res.status;
  const msg = safeError(parsed.error?.message);
  if (code === 190) throw new AppError("META_TOKEN_EXPIRED", "Facebook access expired or was revoked. Open Connectors and Connect with Facebook again.", 424);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80000 || code === 80004) {
    throw new AppError("META_RATE_LIMITED", "Meta's rate limit was hit. Try again in a few minutes.", 429);
  }
  if (code === 10 || code === 200 || code === 294 || (code >= 200 && code < 300)) {
    throw new AppError("META_PERMISSION_DENIED", `The Meta token lacks a permission this report needs: ${msg}`, 403);
  }
  if (code === 100) throw new MetaInvalidParameterError(msg);
  throw new AppError("META_API_ERROR", `Meta refused the request: ${msg}`, res.status >= 400 && res.status < 500 ? 400 : 502);
}

/**
 * Tries each field list in order and returns the first that Meta accepts. Insights metric names change between API
 * versions (impressions -> views); an unsupported metric fails the whole request with code 100, so older or newer
 * names are tried before giving up on insights altogether.
 */
export async function graphGetWithFallback(
  path: string,
  baseParams: Record<string, string>,
  fieldSets: string[],
  token: string,
  signal?: AbortSignal
): Promise<{ body: GraphJson; fieldSetIndex: number }> {
  let lastError: unknown;
  for (let i = 0; i < fieldSets.length; i++) {
    try {
      const body = await graphGet(path, { ...baseParams, fields: fieldSets[i] }, token, signal);
      return { body, fieldSetIndex: i };
    } catch (err) {
      if (!(err instanceof MetaInvalidParameterError)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new AppError("META_API_ERROR", "Meta refused every field combination.", 502);
}

/** Follows paging.next until `maxItems` rows or `stop(row)` says the rest is out of range. */
export async function collectPages(
  first: GraphJson,
  token: string,
  opts: { maxItems: number; stop?: (row: GraphJson) => boolean; signal?: AbortSignal }
): Promise<GraphJson[]> {
  const rows: GraphJson[] = [];
  let page: GraphJson | null = first;
  let pages = 0;
  while (page && pages < 10) {
    pages++;
    const data = Array.isArray(page.data) ? (page.data as GraphJson[]) : [];
    for (const row of data) {
      if (opts.stop?.(row)) return rows;
      rows.push(row);
      if (rows.length >= opts.maxItems) return rows;
    }
    const next: unknown = (page.paging as { next?: unknown } | undefined)?.next;
    page = typeof next === "string" ? await graphGet(next, {}, token, opts.signal) : null;
  }
  return rows;
}

// ---- Short in-memory cache (not the store: GETs never write) ---------------------------------------------------------

const CACHE_TTL_MS = 5 * 60_000;
/** A failed report and a forced refresh are both held this long, so a reader cannot loop Meta with the tenant's token. */
const MIN_REFETCH_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown; ttl: number }>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Caches a report for five minutes; one that `keep` rejects (a Meta error, nothing connected) for one minute. `refresh`
 * skips the cache only when the entry is at least a minute old. Concurrent builds for one key share a single request.
 */
export async function cached<T>(key: string, refresh: boolean, load: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < hit.ttl && !(refresh && age >= MIN_REFETCH_MS)) return hit.value as T;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value, ttl: keep(value) ? CACHE_TTL_MS : MIN_REFETCH_MS });
      if (cache.size > 500) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Changes whenever the tenant's Meta connector or Facebook/Instagram channels change, so a cache key never outlives them. */
export function metaCredentialFingerprint(tenantId: string): string {
  const connector = db.findConnectorByProvider(tenantId, "meta_graph");
  const parts = connector ? [`${connector.id}@${connector.updated_at}:${connector.enabled !== false}`] : [];
  for (const c of db.getConnectedChannels(tenantId)) {
    if (c.type === "FACEBOOK_MESSENGER" || c.type === "INSTAGRAM") parts.push(`${c.id}@${c.updated_at}:${c.status}`);
  }
  return parts.join("|") || "none";
}

export function clearMetaInsightsCacheForTesting(): void {
  cache.clear();
  inFlight.clear();
}

// ---- Number helpers ---------------------------------------------------------------------------------------------------

export function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function ratio(part: number, whole: number, scale = 1): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * scale * 100) / 100;
}

/** Dhaka is UTC+6 with no DST; posting-time advice is given in local time. */
export const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

export function dhakaDate(iso: string): string {
  return new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function rangeFor(days: number, now = new Date()): { since: string; until: string; days: number; sinceMs: number; untilMs: number } {
  const untilMs = now.getTime();
  const sinceMs = untilMs - days * 24 * 60 * 60_000;
  return { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString(), days, sinceMs, untilMs };
}

export function sourceError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  return "Meta returned an unexpected response.";
}
