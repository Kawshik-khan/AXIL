/**
 * Connection lifecycle after sign-in (ADR-119 E7/E8, plan P4): health checks, expiry, revoking a former member's tokens,
 * and Meta's deauthorize / data-deletion callbacks. Every write is a short unit of work; provider calls run outside it.
 * Nothing here reports a connection healthy unless the provider answered for its token.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { randomSuffix } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { PERMISSIONS, ROLE_PERMISSIONS, type RoleName } from "@/lib/permissions";
import { encryptCredential } from "@/lib/security";
import type { ConnectorConfigRecord, ConnectionStatus } from "@/types/connector";
import { OAuthBroker, oauthAdapterForProvider, scopesFor } from "./auth/oauth-broker";
import { detachConnectionResource } from "./resources";

const DAY = 24 * 60 * 60_000;
/** A token expiring within this window makes the connection DEGRADED (still usable; the owner reconnects). */
export const EXPIRY_WARNING_MS = 7 * DAY;
/** A signed_request older than this is refused (replay). */
const SIGNED_REQUEST_MAX_AGE_MS = DAY;
/** At most this many connections are inspected per run (paced; the rest wait for the next run). */
const MAX_CHECKS_PER_RUN = 200;

const nowIso = () => new Date().toISOString();

function audit(tenantId: string, actor: string, action: string, connectionId: string, metadata: Record<string, string>): void {
  db.createAuditLog({
    id: `aud_${Date.now()}_${randomSuffix()}`,
    tenant_id: tenantId,
    actor_user_id: actor,
    action,
    resource_type: "connector_configuration",
    resource_id: connectionId,
    metadata,
    created_at: nowIso(),
  });
}

/** Deletes a connection's token and marks it for reconnecting. Its Pages keep their own Page tokens. */
function dropToken(connection: ConnectorConfigRecord, status: ConnectionStatus, code: string): ConnectorConfigRecord {
  return db.saveConnector({
    ...connection,
    credentials_encrypted: encryptCredential({}),
    credentials_masked: {},
    connection_status: status,
    health_code: code,
    health_checked_at: nowIso(),
    updated_at: nowIso(),
  });
}

/** Sign-in connections that still hold a token (not disconnected). */
function liveSignInConnections(): ConnectorConfigRecord[] {
  return (db.data.connector_configurations || []).filter(
    (c) => c.auth_method === "oauth2" && c.connection_status !== "DISCONNECTED" && OAuthBroker.storedToken(c) !== ""
  );
}

// ==================== Health ====================

export interface HealthRunResult {
  checked: number;
  active: number;
  degraded: number;
  needs_reauth: number;
  check_failed: number;
  skipped: number;
}

/**
 * Scheduled check of every sign-in connection: asks the provider about its token (valid, scopes, expiry). A revoked or
 * expired token is deleted and the connection asks for sign-in again; one that expires within 7 days, or lacks a
 * required scope, is DEGRADED. An unreachable provider changes nothing but the health code.
 */
export async function runConnectionHealth(now = Date.now()): Promise<HealthRunResult> {
  const result: HealthRunResult = { checked: 0, active: 0, degraded: 0, needs_reauth: 0, check_failed: 0, skipped: 0 };
  const due = liveSignInConnections()
    .filter((c) => c.enabled !== false)
    .sort((a, b) => (a.health_checked_at ?? "").localeCompare(b.health_checked_at ?? ""))
    .slice(0, MAX_CHECKS_PER_RUN);

  type Plan = { seen: ConnectorConfigRecord; status: ConnectionStatus; code?: string; scopes?: string[]; expiresAt?: string; account?: string; drop?: boolean };
  const plans: Plan[] = [];
  for (const seen of due) {
    const adapter = oauthAdapterForProvider(seen.provider_id);
    if (!adapter) {
      result.skipped++;
      continue;
    }
    try {
      const inspection = await adapter.inspect({ accessToken: OAuthBroker.storedToken(seen) });
      const expiresAt = inspection.expiresAt ? Date.parse(inspection.expiresAt) : undefined;
      const missing = scopesFor(adapter, []).filter((s) => !inspection.scopes.includes(s));
      const base = { seen, scopes: inspection.scopes, expiresAt: inspection.expiresAt, account: inspection.externalAccountId };
      if (seen.external_account_id && inspection.externalAccountId !== seen.external_account_id) {
        plans.push({ seen, status: "NEEDS_REAUTH", code: "ACCOUNT_CHANGED", drop: true });
      } else if (expiresAt !== undefined && expiresAt <= now) {
        plans.push({ seen, status: "NEEDS_REAUTH", code: "TOKEN_EXPIRED", drop: true });
      } else if (expiresAt !== undefined && expiresAt - now < EXPIRY_WARNING_MS) {
        plans.push({ ...base, status: "DEGRADED", code: "TOKEN_EXPIRING" });
      } else if (missing.length > 0) {
        plans.push({ ...base, status: "DEGRADED", code: "SCOPES_MISSING" });
      } else {
        plans.push({ ...base, status: "ACTIVE" });
      }
    } catch (err) {
      // Only the provider saying the token itself is invalid (or issued to another app) revokes it
      if (err instanceof AppError && err.code.endsWith("_TOKEN_INVALID")) {
        plans.push({ seen, status: "NEEDS_REAUTH", code: "TOKEN_REVOKED", drop: true });
      } else {
        plans.push({ seen, status: seen.connection_status ?? "ACTIVE", code: "CHECK_FAILED" });
      }
    }
  }

  // Circuit breaker: many tokens "revoked" in one run points at our side (app secret, Meta outage), not at merchants
  const drops = plans.filter((p) => p.drop).length;
  if (drops >= 5 && drops > plans.length * 0.2) {
    logger.warn("connection_health.mass_revoke_suspected", { checked: plans.length, revoked: drops });
    for (const p of plans) if (p.drop) Object.assign(p, { drop: false, status: p.seen.connection_status ?? "ACTIVE", code: "CHECK_FAILED" });
  }

  for (const next of plans) {
    const seen = next.seen;
    await db
      .unit(async () => {
        const current = db.findConnectorById(seen.tenant_id, seen.id);
        // Reconnected or changed while the provider was asked: that newer state wins
        if (!current || current.updated_at !== seen.updated_at) return false;
        if (next.drop) {
          dropToken(current, next.status, next.code ?? "TOKEN_REVOKED");
          audit(current.tenant_id, "system:connection-health", "connection.needs_reauth", current.id, { reason: next.code ?? "" });
        } else {
          db.saveConnector({
            ...current,
            connection_status: next.status,
            health_code: next.code,
            health_status: next.code === "CHECK_FAILED" ? current.health_status : next.status === "ACTIVE" ? "HEALTHY" : "DEGRADED",
            scopes_granted: next.scopes ?? current.scopes_granted,
            token_expires_at: next.expiresAt ?? current.token_expires_at,
            // A migrated connection learns whose login it is (deauthorize / deletion find it by this id)
            external_account_id: current.external_account_id ?? next.account,
            health_checked_at: new Date(now).toISOString(),
            // updated_at is left alone: a health check isn't a change a reconnect has to win against
          });
        }
        return true;
      }, (saved) => saved)
      .catch((err: unknown) => logger.warn("connection_health.save_failed", { connection_id: seen.id, error: err instanceof Error ? err.message : "error" }));

    result.checked++;
    if (next.code === "CHECK_FAILED") result.check_failed++;
    else if (next.status === "ACTIVE") result.active++;
    else if (next.status === "DEGRADED") result.degraded++;
    else if (next.status === "NEEDS_REAUTH") result.needs_reauth++;
  }
  return result;
}

/**
 * Sign-in connections that hold a token but don't yet know whose login it is (made by the channel migration): asks
 * the provider and records the account id, so Meta's deauthorize and deletion callbacks find them. Call outside a unit.
 */
export async function identifyUnknownConnections(max = 50): Promise<number> {
  const unknown = liveSignInConnections().filter((c) => !c.external_account_id).slice(0, max);
  let identified = 0;
  for (const seen of unknown) {
    const adapter = oauthAdapterForProvider(seen.provider_id);
    if (!adapter) continue;
    let account: string;
    try {
      account = (await adapter.inspect({ accessToken: OAuthBroker.storedToken(seen) })).externalAccountId;
    } catch {
      continue;
    }
    await db
      .unit(async () => {
        const current = db.findConnectorById(seen.tenant_id, seen.id);
        if (!current || current.external_account_id) return false;
        db.saveConnector({ ...current, external_account_id: account });
        identified++;
        return true;
      }, (saved) => saved)
      .catch(() => undefined);
  }
  return identified;
}

/** Live sign-in connections holding a token whose login is still unknown (see identifyUnknownConnections). */
export function unidentifiedSignInConnections(providerIds: ReadonlySet<string>): ConnectorConfigRecord[] {
  return liveSignInConnections().filter((c) => providerIds.has(c.provider_id) && !c.external_account_id);
}

// ==================== Former members (E8) ====================

/** Whether a user may still hold this workspace's sign-in connections: an active member who may manage channels. */
export function memberMayHoldConnections(tenantId: string, userId: string): boolean {
  const membership = db.findMembership(tenantId, userId);
  if (!membership || membership.status === "SUSPENDED") return false;
  const permissions = ROLE_PERMISSIONS[membership.role as RoleName] ?? [];
  return permissions.includes(PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
}

/**
 * Deletes the tokens of the workspace's sign-in connections this user granted (they left, were suspended, or lost the
 * role). The connections ask for sign-in again; Pages keep working on their Page tokens until someone reconnects.
 * Call inside the unit of work that changed the membership. Returns how many were revoked.
 */
export function revokeMemberConnections(tenantId: string, userId: string, actorUserId: string, reason: string): number {
  let revoked = 0;
  for (const connection of db.getConnectors(tenantId)) {
    if (connection.auth_method !== "oauth2" || connection.owner_user_id !== userId) continue;
    if (connection.connection_status === "DISCONNECTED") continue;
    dropToken(connection, "NEEDS_REAUTH", "OWNER_LEFT");
    audit(tenantId, actorUserId, "connection.owner_access_revoked", connection.id, { owner_user_id: userId, reason });
    revoked++;
  }
  return revoked;
}

// ==================== Meta signed callbacks ====================

/**
 * Verifies a Meta `signed_request` (HMAC-SHA256 of the payload with the app secret, constant-time) and returns the
 * Facebook user id it names, or null.
 */
export function verifyMetaSignedRequest(
  signedRequest: string,
  appSecret: string,
  now = Date.now()
): { userId: string; issuedAt: number } | null {
  if (!appSecret || typeof signedRequest !== "string" || signedRequest.length > 4096) return null;
  const [sigPart, payloadPart, extra] = signedRequest.split(".");
  if (!sigPart || !payloadPart || extra !== undefined) return null;
  // The signature is checked before the payload is parsed (security.md §4)
  let signature: Buffer;
  try {
    signature = Buffer.from(sigPart, "base64url");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", appSecret).update(payloadPart).digest();
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
  // Deauthorize and deletion requests carry neither: a login signed_request (JS SDK, Canvas) is never accepted here
  if ("code" in payload || "oauth_token" in payload) return null;
  const issuedAt = typeof payload.issued_at === "number" ? payload.issued_at * 1000 : NaN;
  if (!Number.isFinite(issuedAt) || now - issuedAt > SIGNED_REQUEST_MAX_AGE_MS || issuedAt - now > 5 * 60_000) return null;
  const userId = typeof payload.user_id === "string" ? payload.user_id : typeof payload.user_id === "number" ? String(payload.user_id) : "";
  if (!/^\d{1,32}$/.test(userId)) return null;
  return { userId, issuedAt };
}

/** Connections of a Facebook user, in every workspace (Meta's callbacks don't name one). Platform use only. */
/** Providers signed in through the CommerceOS Meta app: one grant per Facebook user covers all of them. */
export const META_APP_PROVIDERS: ReadonlySet<string> = new Set(["meta_graph", "whatsapp_cloud"]);

function connectionsOfFacebookUser(facebookUserId: string): ConnectorConfigRecord[] {
  return (db.data.connector_configurations || []).filter(
    (c) => META_APP_PROVIDERS.has(c.provider_id) && c.auth_method === "oauth2" && c.external_account_id === facebookUserId
  );
}

/**
 * The person removed the app in Facebook: their token is worthless and the Page tokens it issued are revoked by Meta.
 * Tokens are deleted, connections ask for sign-in, their Pages are detached (their channels stop, fail closed).
 */
export function handleMetaDeauthorize(facebookUserId: string): number {
  const connections = connectionsOfFacebookUser(facebookUserId);
  for (const connection of connections) {
    dropToken(connection, "NEEDS_REAUTH", "DEAUTHORIZED");
    for (const resource of db.getConnectionResources(connection.tenant_id, connection.id)) {
      if (resource.status !== "DETACHED") detachConnectionResource(connection.tenant_id, resource.id);
    }
    audit(connection.tenant_id, "system:meta", "connection.deauthorized", connection.id, { reason: "meta_deauthorize" });
  }
  return connections.length;
}

/**
 * The person asked Facebook to delete their data: everything CommerceOS holds about that Facebook login goes (the
 * connections with their token, user id and scopes, the resources reached through them and the channels those served).
 * Business records (conversations, orders) belong to the workspace and stay; audit entries keep the account id. Returns a confirmation code that carries no personal data.
 */
export function handleMetaDataDeletion(
  facebookUserId: string,
  appSecret: string,
  status: "COMPLETED" | "IN_PROGRESS" = "COMPLETED"
): { code: string; deleted: number } {
  const connections = connectionsOfFacebookUser(facebookUserId);
  for (const connection of connections) {
    // The channels its Pages served go too (they hold a copy of the Page token issued through that login)
    const resourceIds = new Set(db.getConnectionResources(connection.tenant_id, connection.id).map((r) => r.id));
    for (const channel of db.getConnectedChannels(connection.tenant_id)) {
      if (channel.resource_id && resourceIds.has(channel.resource_id)) db.deleteConnectedChannel(connection.tenant_id, channel.id);
    }
    db.deleteConnector(connection.tenant_id, connection.id); // also deletes its resources
    audit(connection.tenant_id, "system:meta", "connection.data_deleted", connection.id, { reason: "meta_data_deletion" });
  }
  return { code: signDeletionCode(appSecret, Date.now(), status), deleted: connections.length };
}

/** `<base64url(date)>.<hmac>`: lets the status page confirm a deletion without storing anything. */
export function signDeletionCode(appSecret: string, at: number, status: "COMPLETED" | "IN_PROGRESS" = "COMPLETED"): string {
  const body = Buffer.from(JSON.stringify({ d: new Date(at).toISOString(), s: status, n: crypto.randomBytes(6).toString("hex") })).toString("base64url");
  const mac = crypto.createHmac("sha256", `${appSecret}:data-deletion`).update(body).digest("base64url").slice(0, 32);
  return `${body}.${mac}`;
}

export function verifyDeletionCode(appSecret: string, code: string): { completedAt: string; status: "COMPLETED" | "IN_PROGRESS" } | null {
  if (!appSecret || typeof code !== "string" || code.length > 300) return null;
  const [body, mac, extra] = code.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", `${appSecret}:data-deletion`).update(body).digest("base64url").slice(0, 32);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { d?: unknown; s?: unknown };
    if (typeof parsed.d !== "string") return null;
    return { completedAt: parsed.d, status: parsed.s === "IN_PROGRESS" ? "IN_PROGRESS" : "COMPLETED" };
  } catch {
    return null;
  }
}
