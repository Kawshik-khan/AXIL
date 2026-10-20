/**
 * What the Connectors page and the super-admin console show about connections (ADR-119 P6). Read-only: nothing here
 * writes, decrypts a token or returns one. Status comes from what the health job and the flows recorded.
 */
import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { PROVIDER_MANIFESTS } from "@/domains/connectors/manifests";
import type { ConnectionResourceKind, ConnectionResourceStatus, ConnectionStatus, ConnectorAuthMethod } from "@/types/connector";

export interface ConnectionResourceView {
  id: string;
  kind: ConnectionResourceKind;
  external_id: string;
  name: string;
  status: ConnectionResourceStatus;
  /** Non-secret display facts (currency, username, waba_id). */
  metadata: Record<string, string | number | boolean>;
  activated_at?: string;
  channel?: { id: string; status: string; last_event_at?: string; error?: string };
}

export interface ConnectionView {
  id: string;
  provider_id: string;
  auth_method?: ConnectorAuthMethod;
  name: string;
  /** ACTIVE / DEGRADED / NEEDS_REAUTH / DISCONNECTED for sign-in connections; hub rows report ACTIVE. */
  connection_status: ConnectionStatus;
  health_code?: string;
  health_checked_at?: string;
  token_expires_at?: string;
  enabled: boolean;
  owner?: { name?: string; still_member: boolean };
  /** Sign-in only: required scopes Meta didn't grant, and each optional feature with whether it is granted. */
  scopes_missing: string[];
  optional: Array<{ feature: string; granted: boolean }>;
  resources: ConnectionResourceView[];
  updated_at: string;
}

export interface ProviderSummary {
  provider_id: string;
  /** The card's state, best first: CONNECTED, ATTENTION (degraded / a resource needs attention), REAUTH, NONE. */
  state: "CONNECTED" | "ATTENTION" | "REAUTH" | "NONE";
  connections: number;
  /** Soonest expiry among usable connections. */
  expires_at?: string;
  /** Latest inbound event across its channels. */
  last_event_at?: string;
}

function viewOf(connection: ReturnType<typeof db.getConnectors>[number], showOwnerName: boolean): ConnectionView {
  const manifest = PROVIDER_MANIFESTS.find((p) => p.id === connection.provider_id);
  const granted = new Set(connection.scopes_granted ?? []);
  const signIn = connection.auth_method === "oauth2";
  const channels = db.getConnectedChannels(connection.tenant_id);
  const owner = connection.owner_user_id ? db.findUserById(connection.owner_user_id) : undefined;
  return {
    id: connection.id,
    provider_id: connection.provider_id,
    auth_method: connection.auth_method,
    name: connection.name,
    connection_status: connection.connection_status ?? (connection.status === "ACTIVE" ? "ACTIVE" : "NEEDS_REAUTH"),
    health_code: connection.health_code,
    health_checked_at: connection.health_checked_at,
    token_expires_at: connection.token_expires_at,
    enabled: connection.enabled !== false,
    // A name only for roles that may list the team (user.read); everyone sees whether the person is still a member
    owner: owner
      ? { name: showOwnerName ? owner.name : undefined, still_member: Boolean(db.findMembership(connection.tenant_id, owner.id)) }
      : undefined,
    scopes_missing: signIn ? (manifest?.base_scopes ?? []).filter((s) => !granted.has(s)) : [],
    optional: signIn
      ? (manifest?.optional_scopes ?? []).map((o) => ({ feature: o.feature, granted: o.scopes.every((s) => granted.has(s)) }))
      : [],
    resources: db
      .getConnectionResources(connection.tenant_id, connection.id)
      .filter((r) => r.status !== "DETACHED")
      .map((r) => {
        const channel = channels.find((c) => c.resource_id === r.id);
        return {
          id: r.id,
          kind: r.kind,
          external_id: r.external_id,
          name: r.name,
          status: r.status,
          metadata: r.metadata,
          activated_at: r.activated_at,
          channel: channel
            ? { id: channel.id, status: channel.status, last_event_at: channel.last_webhook_at, error: channel.error_message }
            : undefined,
        };
      }),
    updated_at: connection.updated_at,
  };
}

function summarize(providerId: string, views: ConnectionView[]): ProviderSummary {
  const live = views.filter((v) => v.connection_status !== "DISCONNECTED");
  const usable = live.filter((v) => v.enabled && (v.connection_status === "ACTIVE" || v.connection_status === "DEGRADED"));
  const attention =
    usable.some((v) => v.connection_status === "DEGRADED") ||
    usable.some((v) => v.resources.some((r) => r.status === "NEEDS_ATTENTION" || (r.channel && r.channel.status !== "ACTIVE")));
  const state: ProviderSummary["state"] = usable.length
    ? attention
      ? "ATTENTION"
      : "CONNECTED"
    : live.some((v) => v.connection_status === "NEEDS_REAUTH")
      ? "REAUTH"
      : "NONE";
  const expiries = usable.map((v) => v.token_expires_at).filter((e): e is string => Boolean(e)).sort();
  const events = live
    .flatMap((v) => v.resources.map((r) => r.channel?.last_event_at))
    .filter((e): e is string => Boolean(e))
    .sort();
  return { provider_id: providerId, state, connections: live.length, expires_at: expiries[0], last_event_at: events[events.length - 1] };
}

export class ConnectionsService {
  /** The workspace's connections with their resources, and one summary per provider for the cards. */
  public static list(context: RequestContext): { connections: ConnectionView[]; summaries: ProviderSummary[] } {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const showOwnerName = RbacService.can(context, PERMISSIONS.USER_READ);
    const connections = db.getConnectors(context.tenant.id).map((c) => viewOf(c, showOwnerName));
    const providerIds = [...new Set(connections.map((c) => c.provider_id))];
    return {
      connections,
      summaries: providerIds.map((id) => summarize(id, connections.filter((c) => c.provider_id === id))),
    };
  }

  /**
   * Platform view: counts only, across workspaces — no workspace names, account ids or tokens. For the super-admin
   * console's connection health card.
   */
  public static platformHealth(now = Date.now()): {
    by_provider: Array<{ provider_id: string; total: number; by_status: Record<string, number>; by_health_code: Record<string, number> }>;
    expiring_within_7_days: number;
    workspaces_needing_reauth: number;
    app: { meta_app_configured: boolean; whatsapp_signup_configured: boolean; app_url_https: boolean };
  } {
    const rows = (db.data.connector_configurations || []).filter((c) => c.auth_method === "oauth2");
    const byProvider = new Map<string, { total: number; by_status: Record<string, number>; by_health_code: Record<string, number> }>();
    for (const row of rows) {
      const entry = byProvider.get(row.provider_id) ?? { total: 0, by_status: {}, by_health_code: {} };
      entry.total++;
      const status = row.connection_status ?? "UNKNOWN";
      entry.by_status[status] = (entry.by_status[status] ?? 0) + 1;
      if (row.health_code) entry.by_health_code[row.health_code] = (entry.by_health_code[row.health_code] ?? 0) + 1;
      byProvider.set(row.provider_id, entry);
    }
    const weekAhead = now + 7 * 86_400_000;
    return {
      by_provider: [...byProvider.entries()].map(([provider_id, v]) => ({ provider_id, ...v })),
      expiring_within_7_days: rows.filter(
        (r) => r.connection_status !== "NEEDS_REAUTH" && r.token_expires_at && Date.parse(r.token_expires_at) < weekAhead
      ).length,
      workspaces_needing_reauth: new Set(rows.filter((r) => r.connection_status === "NEEDS_REAUTH").map((r) => r.tenant_id)).size,
      app: {
        meta_app_configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
        whatsapp_signup_configured: /^\d{1,32}$/.test(process.env.META_WA_CONFIG_ID ?? ""),
        app_url_https: /^https:\/\//.test(process.env.APP_URL ?? ""),
      },
    };
  }
}
