/**
 * One-time move of "Connect with Facebook" channels onto connections and resources (ADR-119, plan P2).
 *
 * For each workspace's Facebook / Instagram channel that was connected by Facebook login and has no `resource_id` yet:
 * - the connection is the one its ad account already names (`adsConnectionId`, if usable), else the sign-in connection
 *   of whoever connected it, else a new one for them: `auth_method: oauth2`, owner = that member (a user id that isn't a
 *   member of the workspace is not trusted), holding the user token if the first ad-account release stored that
 *   member's token on the channel (`adsToken`), otherwise `NEEDS_REAUTH` with no token;
 * - the Page / Instagram account becomes a resource of that connection holding the Page token, and the channel points
 *   at it (the channel keeps its own copy for one release);
 * - an ad account recorded on the channel becomes the workspace's AD_ACCOUNT resource (if it has none yet), and the
 *   copied user token (`adsToken`, `adsTokenOwner`) is removed from the channel.
 * Channels connected with a pasted token are left as they are (reported): they reconnect with Facebook later.
 * Idempotent: a channel that already has a resource is skipped. Nothing is sent to Meta.
 */
import { db } from "@/infrastructure/db";
import { randomSuffix } from "@/lib/ids";
import { decryptCredential, encryptCredential, maskSecret } from "@/lib/security";
import { PROVIDER_MANIFESTS } from "@/domains/connectors/manifests";
import type { ConnectorConfigRecord } from "@/types/connector";
import type { ConnectedChannel } from "@/types/social";
import { normalizeAdAccountId } from "@/domains/social/insights/meta-graph-reader";
import { bindAdAccount, upsertConnectionResource } from "./resources";

export interface ChannelMigrationReport {
  lines: string[];
  migrated: number;
  connectionsCreated: number;
  adAccountsBound: number;
  skipped: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function readChannelCredentials(channel: ConnectedChannel): Record<string, unknown> | null {
  try {
    return channel.credentials_encrypted ? decryptCredential<Record<string, unknown>>(channel.credentials_encrypted) : null;
  } catch {
    return null;
  }
}

function createMigratedConnection(tenantId: string, owner: string, userToken: string): ConnectorConfigRecord {
  const manifest = PROVIDER_MANIFESTS.find((p) => p.id === "meta_graph");
  const now = new Date().toISOString();
  return db.saveConnector({
    id: `conn_meta_graph_${Date.now()}_${randomSuffix()}`,
    tenant_id: tenantId,
    provider_id: "meta_graph",
    category: "SOCIAL_ADS",
    name: `${manifest?.name ?? "Meta"} (sign-in)`,
    credentials_encrypted: encryptCredential(userToken ? { access_token: userToken, kind: "user" } : {}),
    credentials_masked: userToken ? { access_token: maskSecret(userToken) } : {},
    configuration: {},
    status: "ACTIVE",
    // Never inspected with Meta: scopes and expiry are unknown until the next sign-in
    health_status: "UNVERIFIED",
    capabilities: manifest?.capabilities,
    enabled: true,
    auth_method: "oauth2",
    owner_user_id: owner || undefined,
    scopes_granted: [],
    connection_status: userToken ? "ACTIVE" : "NEEDS_REAUTH",
    health_code: "MIGRATED_NOT_INSPECTED",
    created_at: now,
    updated_at: now,
  });
}

/**
 * Plans the move and, with `apply`, writes it. Call `apply` inside a store unit (scripts: an open store session).
 * Report lines never contain tokens.
 */
export function migrateChannelsToConnections(apply: boolean): ChannelMigrationReport {
  const report: ChannelMigrationReport = { lines: [], migrated: 0, connectionsCreated: 0, adAccountsBound: 0, skipped: 0 };
  const out = (line: string) => report.lines.push(line);
  const channels = db.data.connected_channels.filter(
    (c) => (c.type === "FACEBOOK_MESSENGER" || c.type === "INSTAGRAM") && !c.resource_id
  );
  const byTenant = new Map<string, ConnectedChannel[]>();
  for (const channel of channels) byTenant.set(channel.tenant_id, [...(byTenant.get(channel.tenant_id) ?? []), channel]);

  for (const [tenantId, list] of byTenant) {
    // Connections made by this run, per owner ("" = unknown); `null` = planned in a dry run
    const created = new Map<string, ConnectorConfigRecord | null>();
    let adPlanned = db.getConnectionResources(tenantId).some((r) => r.kind === "AD_ACCOUNT" && r.status === "ACTIVE");
    // An owner must be a member of this workspace; a value written into channel credentials is not trusted otherwise
    const member = (userId: string): string => (userId && db.findMembership(tenantId, userId) ? userId : "");
    const usable = (c: ConnectorConfigRecord | undefined): c is ConnectorConfigRecord =>
      !!c && c.tenant_id === tenantId && c.provider_id === "meta_graph" && c.auth_method === "oauth2" &&
      c.connection_status !== "DISCONNECTED" && c.enabled !== false;

    for (const channel of list) {
      const creds = readChannelCredentials(channel);
      if (!creds) {
        report.skipped++;
        out(`skip     ${channel.id} (${tenantId}): credentials unreadable`);
        continue;
      }
      if (creds.connectedVia !== "facebook_login") {
        report.skipped++;
        out(`skip     ${channel.id} (${tenantId}): pasted token, reconnect with Facebook later`);
        continue;
      }
      const { adsToken: legacyToken, adsTokenOwner: legacyOwner, ...kept } = creds;
      const pageToken = str(creds.accessToken);
      const kind = channel.type === "INSTAGRAM" ? "IG_ACCOUNT" : "FB_PAGE";
      const holders = db.findLiveConnectionResourcesByExternalId(kind, channel.provider_account_id).filter((r) => r.tenant_id !== tenantId);
      if (holders.length > 0) {
        report.skipped++;
        out(`skip     ${channel.id} (${tenantId}): ${kind} ${channel.provider_account_id} is held by another workspace`);
        // The copied user token is removed even from a skipped channel
        if (apply && legacyToken !== undefined) db.updateConnectedChannel(tenantId, channel.id, { credentials_encrypted: encryptCredential(kept) });
        continue;
      }

      // Which connection: the one its ad account names, else this person's sign-in connection, else a new one for them
      const owner = member(str(legacyOwner)) || member(str(creds.connectedBy));
      const named = str(creds.adsConnectionId) ? db.findConnectorById(tenantId, str(creds.adsConnectionId)) : undefined;
      const owned = db
        .getConnectors(tenantId)
        .filter((c) => usable(c) && (owner ? c.owner_user_id === owner : true))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      let connection: ConnectorConfigRecord | undefined = usable(named) ? named : owned;
      if (!connection) {
        if (!created.has(owner)) {
          // The first ad-account release copied the signed-in user's token onto the channel: it moves to the connection
          const userToken = owner && member(str(legacyOwner)) === owner ? str(legacyToken) : "";
          out(`connect  ${tenantId}: new sign-in connection (owner ${owner || "unknown"}, ${userToken ? "with the ad token" : "needs sign-in"})`);
          report.connectionsCreated++;
          created.set(owner, apply ? createMigratedConnection(tenantId, owner, userToken) : null);
        }
        connection = created.get(owner) ?? undefined;
      }

      report.migrated++;
      out(`resource ${channel.id} (${tenantId}): ${kind} ${channel.provider_account_id}`);
      const adAccountId = normalizeAdAccountId(str(creds.adAccountId));
      // One ad account per workspace: the first channel's, unless the workspace already has one
      const bindAd = Boolean(adAccountId) && !adPlanned;
      if (bindAd) {
        adPlanned = true;
        report.adAccountsBound++;
        out(`ads      ${tenantId}: ad account ${adAccountId}`);
      }
      if (!apply || !connection) continue;

      const resource = upsertConnectionResource(tenantId, connection.id, kind, channel.provider_account_id, {
        name: channel.name,
        token: pageToken || undefined,
        status: channel.status === "ACTIVE" ? "ACTIVE" : "NEEDS_ATTENTION",
        activated: channel.status === "ACTIVE",
      });
      db.updateConnectedChannel(tenantId, channel.id, { resource_id: resource.id, credentials_encrypted: encryptCredential(kept) });
      if (bindAd) {
        const ad = upsertConnectionResource(tenantId, connection.id, "AD_ACCOUNT", adAccountId, {
          name: str(creds.adAccountName) || `Ad account ${adAccountId}`,
          status: "ACTIVE",
          activated: true,
        });
        const replaced = bindAdAccount(tenantId, ad.id);
        db.createAuditLog({
          id: `aud_${Date.now()}_${randomSuffix()}`,
          tenant_id: tenantId,
          actor_user_id: "system:migration",
          action: "connection.ad_account_bound",
          resource_type: "connection_resource",
          resource_id: ad.id,
          metadata: { ad_account_id: adAccountId, connection_id: connection.id, replaced_ad_account_ids: replaced.join(",") || "NONE", source: "channel_migration" },
          created_at: new Date().toISOString(),
        });
      }
    }
  }
  out(`migrated ${report.migrated}, new connections ${report.connectionsCreated}, ad accounts ${report.adAccountsBound}, skipped ${report.skipped}`);
  return report;
}
