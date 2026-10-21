"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import type { ConnectionView } from "@/domains/connectors/connections.service";
import type { ConnectorProviderDefinition } from "@/types/connector";
import styles from "./ConnectionDrawer.module.css";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Working",
  DEGRADED: "Needs attention",
  NEEDS_REAUTH: "Reconnect needed",
  DISCONNECTED: "Disconnected",
};

/** Plain words for the health codes the health job and the flows record. */
const HEALTH_LABEL: Record<string, string> = {
  TOKEN_EXPIRING: "Access expires soon. Reconnect to renew it.",
  TOKEN_EXPIRED: "Access expired. Reconnect.",
  TOKEN_REVOKED: "Access was removed at the provider. Reconnect.",
  SCOPES_MISSING: "Some permissions weren't granted. Reconnect and allow them.",
  OWNER_LEFT: "The person who connected it left or lost access. Someone else needs to reconnect.",
  DEAUTHORIZED: "The app was removed in Facebook. Reconnect.",
  ACCOUNT_CHANGED: "A different account answered for this connection. Reconnect.",
  CHECK_FAILED: "The last check couldn't reach the provider. It will be checked again.",
  MIGRATED_NOT_INSPECTED: "Moved from an older setup; not checked with the provider yet.",
};

const KIND_LABEL: Record<string, string> = {
  FB_PAGE: "Facebook Page",
  IG_ACCOUNT: "Instagram account",
  AD_ACCOUNT: "Ad account",
  WA_NUMBER: "WhatsApp number",
  TELEGRAM_BOT: "Telegram bot",
  COURIER_STORE: "Courier store",
  SHOP: "Shop",
};

const FEATURE_LABEL: Record<string, string> = { ads: "Ad Manager (read ads)" };

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export interface ConnectionDrawerProps {
  provider: ConnectorProviderDefinition;
  connections: ConnectionView[];
  onClose: () => void;
  /** Starts the provider's sign-in again (renews access, adds Pages or numbers). Undefined for hub connectors. */
  onReconnect?: (features?: string[]) => void;
  /** DELETE /api/v1/connectors/{id}; resolves when done. */
  onDisconnect: (connectionId: string) => Promise<void>;
  busy?: boolean;
  /** Sign-in providers: "Reconnect" and "Connect another"; hub connectors: "Edit" only. */
  signIn?: boolean;
}

/** A provider's connections in detail: what each reaches, who connected it, its access and its last activity. */
export function ConnectionDrawer({ provider, connections, onClose, onReconnect, onDisconnect, busy, signIn = true }: ConnectionDrawerProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = connections.filter((c) => c.connection_status !== "DISCONNECTED");

  const disconnect = async (id: string) => {
    setError(null);
    try {
      await onDisconnect(id);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={provider.name}>
      <div className={styles.body}>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        {live.length === 0 && <p className={styles.muted}>Nothing connected yet.</p>}
        {live.map((c) => (
          <section key={c.id} className={styles.connection} aria-label={c.name}>
            <header className={styles.connectionHeader}>
              <div>
                <strong>{c.name}</strong>
                <p className={styles.muted}>
                  {c.owner
                    ? `Connected by ${c.owner.name ?? "a team member"}${c.owner.still_member ? "" : " (no longer a member)"}`
                    : "Connected"}{" "}
                  ·
                  updated {when(c.updated_at)}
                </p>
              </div>
              <span className={`${styles.pill} ${c.connection_status === "ACTIVE" && c.enabled ? styles.pillOk : styles.pillWarn}`}>
                {c.enabled ? STATUS_LABEL[c.connection_status] ?? c.connection_status : "Paused"}
              </span>
            </header>

            {c.health_code && HEALTH_LABEL[c.health_code] && <p className={styles.notice}>{HEALTH_LABEL[c.health_code]}</p>}

            <dl className={styles.facts}>
              {c.auth_method === "oauth2" && (
                <>
                  <dt>Access expires</dt>
                  <dd>{c.token_expires_at ? when(c.token_expires_at) : "Doesn't expire"}</dd>
                  <dt>Last checked</dt>
                  <dd>{when(c.health_checked_at)}</dd>
                </>
              )}
              {c.scopes_missing.length > 0 && (
                <>
                  <dt>Not granted</dt>
                  <dd>{c.scopes_missing.join(", ")}</dd>
                </>
              )}
              {c.optional.map((o) => (
                <React.Fragment key={o.feature}>
                  <dt>{FEATURE_LABEL[o.feature] ?? o.feature}</dt>
                  <dd>
                    {o.granted ? (
                      "Allowed"
                    ) : onReconnect ? (
                      <button type="button" className={styles.link} onClick={() => onReconnect([o.feature])} disabled={busy}>
                        Allow
                      </button>
                    ) : (
                      "Not allowed"
                    )}
                  </dd>
                </React.Fragment>
              ))}
            </dl>

            <h4 className={styles.subheading}>Connected</h4>
            {c.resources.length === 0 ? (
              <p className={styles.muted}>Nothing picked yet.</p>
            ) : (
              <ul className={styles.resources}>
                {c.resources.map((r) => (
                  <li key={r.id} className={styles.resource}>
                    <span>
                      <span className={styles.kind}>{KIND_LABEL[r.kind] ?? r.kind}</span> {r.name}
                    </span>
                    <span className={styles.muted}>
                      {r.status === "ACTIVE" ? "Working" : "Needs attention"}
                      {r.channel ? ` · ${r.channel.last_event_at ? `last message ${when(r.channel.last_event_at)}` : "no messages yet"}` : ""}
                    </span>
                    {r.channel?.error && <span className={styles.notice}>{r.channel.error}</span>}
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.actions}>
              {onReconnect && (
                <button type="button" className={styles.secondary} onClick={() => onReconnect()} disabled={busy}>
                  {signIn ? "Reconnect" : "Edit"}
                </button>
              )}
              {confirming === c.id ? (
                <>
                  <span className={styles.muted}>Disconnect removes its channels; messages stop arriving.</span>
                  <button type="button" className={styles.danger} onClick={() => disconnect(c.id)} disabled={busy}>
                    Confirm disconnect
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setConfirming(null)} disabled={busy}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={styles.secondary} onClick={() => setConfirming(c.id)} disabled={busy}>
                  Disconnect
                </button>
              )}
            </div>
          </section>
        ))}
        {onReconnect && signIn && (
          <button type="button" className={styles.primary} onClick={() => onReconnect()} disabled={busy}>
            Connect another
          </button>
        )}
      </div>
    </Modal>
  );
}
