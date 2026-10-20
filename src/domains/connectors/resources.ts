/**
 * Connection resources (ADR-119 E2/E3, plan P2): what a connection reaches at the provider, and which one a feature uses.
 * Callers run these inside a store unit of work. The store itself refuses a second live Page / Instagram account /
 * WhatsApp number / Telegram bot in any workspace (audit H5).
 */
import { db } from "@/infrastructure/db";
import { randomSuffix } from "@/lib/ids";
import { decryptCredential, encryptCredential } from "@/lib/security";
import type {
  ConnectionResource,
  ConnectionResourceKind,
  ConnectionResourceStatus,
  ConnectorConfigRecord,
  ConnectorProviderDefinition,
} from "@/types/connector";
import { OAuthBroker } from "./auth/oauth-broker";

export interface ResourceInput {
  name: string;
  metadata?: Record<string, string | number | boolean>;
  /** The resource's own token (a Page token); stored encrypted. Omit to keep the stored one. */
  token?: string;
  status: ConnectionResourceStatus;
  activated?: boolean;
}

/**
 * Creates or refreshes a workspace's resource for one connection. If the same provider object is live under another of
 * the workspace's connections (another person signed in), that one is detached and this connection takes it over.
 */
export function upsertConnectionResource(
  tenantId: string,
  connectionId: string,
  kind: ConnectionResourceKind,
  externalId: string,
  input: ResourceInput
): ConnectionResource {
  const now = new Date().toISOString();
  const live = db.getConnectionResources(tenantId).filter((r) => r.kind === kind && r.external_id === externalId && r.status !== "DETACHED");
  const own = live.find((r) => r.connection_id === connectionId);
  for (const other of live.filter((r) => r.connection_id !== connectionId)) detachConnectionResource(tenantId, other.id);
  const patch: Partial<ConnectionResource> = {
    name: input.name.slice(0, 120),
    metadata: input.metadata ?? own?.metadata ?? {},
    status: input.status,
    ...(input.token ? { token_encrypted: encryptCredential({ token: input.token }) } : {}),
    ...(input.activated ? { activated_at: now } : {}),
  };
  if (own) return db.updateConnectionResource(tenantId, own.id, patch);
  // A detached row of this connection is revived rather than duplicated
  const detached = db
    .getConnectionResources(tenantId, connectionId)
    .find((r) => r.kind === kind && r.external_id === externalId && r.status === "DETACHED");
  if (detached) return db.updateConnectionResource(tenantId, detached.id, patch);
  return db.createConnectionResource({
    id: `cres_${Date.now()}_${randomSuffix()}`,
    tenant_id: tenantId,
    connection_id: connectionId,
    kind,
    external_id: externalId,
    name: input.name.slice(0, 120),
    metadata: input.metadata ?? {},
    token_encrypted: input.token ? encryptCredential({ token: input.token }) : undefined,
    status: input.status,
    activated_at: input.activated ? now : undefined,
    created_at: now,
    updated_at: now,
  });
}

/** Detaches a resource and erases its token: a detached Page keeps nothing it could be used with. */
export function detachConnectionResource(tenantId: string, resourceId: string): void {
  db.updateConnectionResource(tenantId, resourceId, { status: "DETACHED", token_encrypted: undefined, activated_at: undefined });
}

/**
 * A connector saved in Connector Hub (API key or bot token) is a connection too (ADR-119 P5): records the one resource it
 * reaches — the Telegram bot (its id is the token's prefix), the courier store (its `store_id`, else the connector) — and
 * detaches any other the connection had (a changed bot token or store). Returns the resource, or undefined when the
 * provider has nothing to record. Run inside the save's unit of work.
 */
export function syncHubConnectorResource(
  provider: ConnectorProviderDefinition,
  connector: ConnectorConfigRecord,
  credentials: Record<string, unknown>
): ConnectionResource | undefined {
  const kind = provider.resource_kinds[0];
  if (!kind || (provider.auth_method !== "api_key" && provider.auth_method !== "bot_token")) return undefined;
  let externalId = "";
  let name = provider.name;
  if (kind === "TELEGRAM_BOT") {
    externalId = String(credentials.bot_token ?? "").trim().split(":")[0];
    name = connector.name;
  } else {
    const store = String(credentials.store_id ?? "").trim();
    externalId = /^[A-Za-z0-9_-]{1,64}$/.test(store) ? store : connector.id;
    name = store ? `${provider.name} store ${store}` : provider.name;
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(externalId)) return undefined;
  for (const other of db.getConnectionResources(connector.tenant_id, connector.id)) {
    if (other.status !== "DETACHED" && !(other.kind === kind && other.external_id === externalId)) {
      detachConnectionResource(connector.tenant_id, other.id);
    }
  }
  return upsertConnectionResource(connector.tenant_id, connector.id, kind, externalId, { name, status: "ACTIVE", activated: true });
}

/** Makes this ad account the one Ad Manager reads; the workspace's other ad accounts are detached. Returns their ids. */
export function bindAdAccount(tenantId: string, resourceId: string): string[] {
  const replaced: string[] = [];
  for (const other of db.getConnectionResources(tenantId)) {
    if (other.kind === "AD_ACCOUNT" && other.id !== resourceId && other.status !== "DETACHED") {
      detachConnectionResource(tenantId, other.id);
      replaced.push(other.external_id);
    }
  }
  return replaced;
}

/** The resource's own token, or "" (decrypted in memory only). */
export function resourceToken(resource: ConnectionResource): string {
  if (!resource.token_encrypted) return "";
  try {
    const raw = decryptCredential<Record<string, unknown>>(resource.token_encrypted);
    return typeof raw.token === "string" ? raw.token : "";
  } catch {
    return "";
  }
}

/**
 * The token a channel uses for this resource: its own (a Page token) or, for a resource without one (a WhatsApp number),
 * its connection's while that connection can be used. "" otherwise.
 */
export function resourceAccessToken(resource: ConnectionResource): string {
  const own = resourceToken(resource);
  if (own) return own;
  const connection = db.findConnectorById(resource.tenant_id, resource.connection_id);
  return connection ? OAuthBroker.connectionToken(connection) : "";
}

export interface AdsAccess {
  adAccountId: string;
  adsToken: string;
  connectionId: string;
  resourceId: string;
}

/**
 * Ad Manager's account (capability ADS_READ): the workspace's live ad account resource and the token of the connection
 * it came from. Null when none is picked or that connection can't be used (disabled, expired, disconnected).
 */
export function resolveAdsAccess(tenantId: string): AdsAccess | null {
  const resource = db.getConnectionResources(tenantId).find((r) => r.kind === "AD_ACCOUNT" && r.status === "ACTIVE");
  if (!resource) return null;
  const connection = db.findConnectorById(tenantId, resource.connection_id);
  const token = connection ? OAuthBroker.connectionToken(connection) : "";
  if (!token) return null;
  return { adAccountId: resource.external_id, adsToken: token, connectionId: resource.connection_id, resourceId: resource.id };
}
