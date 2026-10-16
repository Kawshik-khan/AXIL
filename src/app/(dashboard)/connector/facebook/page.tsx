"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Facebook, Instagram, RefreshCw } from "lucide-react";
import { LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import type { ConnectedChannel } from "@/types/social";
import styles from "./facebook.module.css";

type PageState = "NOT_CONNECTED" | "CONNECTED_HERE" | "IN_ANOTHER_WORKSPACE";
interface PickablePage {
  id: string;
  name: string;
  can_message: boolean;
  facebook: PageState;
  instagram?: { id: string; username?: string; state: PageState };
}
type Outcome = "CONNECTED" | "RECONNECTED" | "CONNECTED_NO_WEBHOOKS" | "IN_ANOTHER_WORKSPACE" | "FAILED" | "SKIPPED";
interface ConnectResult {
  page_id: string;
  name: string;
  facebook: Outcome;
  instagram?: Outcome;
  instagram_username?: string;
  webhooks_subscribed: boolean;
  error?: string;
}

/** Short codes from the callback redirect; Meta's own text never travels in the URL. */
const CALLBACK_ERRORS: Record<string, string> = {
  META_DENIED: "Facebook sign-in was cancelled. Nothing was connected.",
  META_STATE_INVALID: "That Facebook sign-in link expired or was opened in another browser. Start again.",
  META_LOGIN_NOT_CONFIGURED: "Connect with Facebook isn't set up on this server yet. Ask your administrator to add the Meta app settings.",
  META_TOKEN_INVALID: "Facebook sign-in expired. Start again.",
  META_UNREACHABLE: "Facebook could not be reached. Try again.",
  FORBIDDEN: "Your role can't connect channels.",
};

const STATE_LABEL: Record<PageState, string> = {
  NOT_CONNECTED: "Not connected",
  CONNECTED_HERE: "Connected (will refresh)",
  IN_ANOTHER_WORKSPACE: "In another workspace",
};
const OUTCOME_LABEL: Record<Outcome, string> = {
  CONNECTED: "Connected",
  RECONNECTED: "Refreshed",
  CONNECTED_NO_WEBHOOKS: "Saved, not receiving events",
  IN_ANOTHER_WORKSPACE: "Connected to another workspace",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

function ConnectFacebook() {
  const params = useSearchParams();
  const [pages, setPages] = useState<PickablePage[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeInstagram, setIncludeInstagram] = useState(true);
  const [channels, setChannels] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("error");
    return code ? CALLBACK_ERRORS[code] ?? "Facebook sign-in didn't finish. Start again." : null;
  });
  const [forbidden, setForbidden] = useState(false);
  const [results, setResults] = useState<ConnectResult[] | null>(null);

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/v1/social/channels").catch(() => null);
    if (res?.status === 403) setForbidden(true);
    if (!res?.ok) return;
    const json = await res.json();
    const list: ConnectedChannel[] = json.data?.channels ?? json.data ?? [];
    setChannels(Array.isArray(list) ? list.filter((c) => c.type === "FACEBOOK_MESSENGER" || c.type === "INSTAGRAM") : []);
  }, []);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/social/meta/pages");
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) setForbidden(true);
      if (!res.ok) {
        setPages(null);
        // 404 = no Facebook sign-in yet: show the Connect button, not an error
        if (res.status !== 404 && res.status !== 403) setError(json?.error?.message ?? "Could not load your Pages.");
        return;
      }
      const list: PickablePage[] = json.data?.pages ?? [];
      setPages(list);
      setMissing(json.data?.missing_permissions ?? []);
      setSelected(new Set(list.filter((p) => p.facebook !== "IN_ANOTHER_WORKSPACE").map((p) => p.id)));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
    loadPages();
  }, [loadChannels, loadPages]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/social/meta/connect", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 403 ? CALLBACK_ERRORS.FORBIDDEN : json?.error?.message ?? "Could not start Facebook sign-in.");
        return;
      }
      window.location.href = json.data.url;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/social/meta/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_ids: Array.from(selected), include_instagram: includeInstagram }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not connect the Pages.");
        return;
      }
      setResults(json.data.results as ConnectResult[]);
      setPages(null);
      loadChannels();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (forbidden) {
    return (
      <div className={styles.page}>
        <PermissionDenied resource="Facebook and Instagram channels" requiredPermission="social.channel.manage" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Facebook size={22} /> Connect Facebook &amp; Instagram
        </h1>
        <p className={styles.subtitle}>
          Sign in with Facebook and choose your Pages. CommerceOS will receive their comments and messages, so Comment → Inbox
          triggers and the inbox work. Linked Instagram business accounts are connected too.
        </p>
      </header>

      {error && <p className={styles.alert} role="alert">{error}</p>}

      {results && (
        <section className={styles.card} aria-label="Connection results">
          <h2 className={styles.cardTitle}>Result</h2>
          <ul className={styles.pageList}>
            {results.map((r) => (
              <li key={r.page_id} className={styles.pageRow}>
                <div>
                  <span className={styles.pageName}>{r.name}</span>
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${r.facebook === "CONNECTED" || r.facebook === "RECONNECTED" ? styles.badgeOk : styles.badgeBad}`}>
                      Facebook: {OUTCOME_LABEL[r.facebook]}
                    </span>
                    {r.instagram && (
                      <span className={`${styles.badge} ${r.instagram === "CONNECTED" || r.instagram === "RECONNECTED" ? styles.badgeOk : styles.badgeBad}`}>
                        Instagram{r.instagram_username ? ` @${r.instagram_username}` : ""}: {OUTCOME_LABEL[r.instagram]}
                      </span>
                    )}
                    <span className={`${styles.badge} ${r.webhooks_subscribed ? styles.badgeOk : styles.badgeBad}`}>
                      {r.webhooks_subscribed ? "Receiving comments & messages" : "Not receiving events"}
                    </span>
                  </div>
                  {r.error && <p className={styles.muted}>{r.error}</p>}
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Link href="/engagement" className={styles.primaryButton}>Set up comment triggers</Link>
            <button type="button" className={styles.ghostButton} onClick={start} disabled={busy}>Connect more Pages</button>
          </div>
        </section>
      )}

      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : pages ? (
        <section className={styles.card} aria-label="Choose Pages">
          <h2 className={styles.cardTitle}>Choose the Pages to connect</h2>
          {missing.length > 0 && (
            <p className={styles.warning}>
              Facebook didn&apos;t grant: {missing.join(", ")}. Some features (comments, messages or Instagram) won&apos;t work until you
              connect again and allow them.
            </p>
          )}
          {pages.length === 0 ? (
            <p className={styles.muted}>This Facebook account doesn&apos;t manage any Pages, or you didn&apos;t select any during sign-in.</p>
          ) : (
            <ul className={styles.pageList}>
              {pages.map((p) => {
                const blocked = p.facebook === "IN_ANOTHER_WORKSPACE";
                return (
                  <li key={p.id}>
                    <label className={`${styles.pageRow} ${blocked ? styles.pageRowDisabled : ""}`}>
                      <input type="checkbox" checked={selected.has(p.id)} disabled={blocked} onChange={() => toggle(p.id)} />
                      <div>
                        <span className={styles.pageName}>{p.name}</span>
                        <div className={styles.badges}>
                          <span className={`${styles.badge} ${blocked ? styles.badgeBad : ""}`}>
                            <Facebook size={12} /> {STATE_LABEL[p.facebook]}
                          </span>
                          {p.instagram ? (
                            <span className={`${styles.badge} ${p.instagram.state === "IN_ANOTHER_WORKSPACE" ? styles.badgeBad : ""}`}>
                              <Instagram size={12} /> {p.instagram.username ? `@${p.instagram.username}` : "Instagram"} · {STATE_LABEL[p.instagram.state]}
                            </span>
                          ) : (
                            <span className={styles.badge}>No linked Instagram</span>
                          )}
                          {!p.can_message && <span className={`${styles.badge} ${styles.badgeBad}`}>You can&apos;t message as this Page</span>}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <label className={styles.check}>
            <input type="checkbox" checked={includeInstagram} onChange={(e) => setIncludeInstagram(e.target.checked)} /> Also connect linked Instagram accounts
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={connect} disabled={busy || selected.size === 0}>
              {busy ? "Connecting…" : `Connect ${selected.size} Page${selected.size === 1 ? "" : "s"}`}
            </button>
            <button type="button" className={styles.ghostButton} onClick={start} disabled={busy}>
              <RefreshCw size={14} /> Sign in again
            </button>
          </div>
        </section>
      ) : (
        !results && (
          <section className={styles.card} aria-label="Connect with Facebook">
            <h2 className={styles.cardTitle}>Sign in with Facebook</h2>
            <ol className={styles.steps}>
              <li>Sign in with the Facebook account that manages your shop&apos;s Page.</li>
              <li>Pick your Page(s) and allow the permissions Facebook asks for.</li>
              <li>Come back here and confirm. Comments and messages start arriving right away.</li>
            </ol>
            <button type="button" className={styles.primaryButton} onClick={start} disabled={busy}>
              <Facebook size={16} /> {busy ? "Opening Facebook…" : "Connect with Facebook"}
            </button>
          </section>
        )
      )}

      <section className={styles.card} aria-label="Connected channels">
        <h2 className={styles.cardTitle}>Connected Facebook &amp; Instagram channels</h2>
        {channels.length === 0 ? (
          <p className={styles.muted}>None yet.</p>
        ) : (
          <ul className={styles.channelList}>
            {channels.map((c) => (
              <li key={c.id}>
                {c.type === "INSTAGRAM" ? "Instagram" : "Facebook"} · {c.name} · {c.status === "ACTIVE" ? "Active" : c.status}
                {c.last_webhook_at ? ` · last event ${new Date(c.last_webhook_at).toLocaleString()}` : " · no events received yet"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ConnectFacebookPage() {
  return (
    <Suspense fallback={<LoadingSkeleton lines={4} />}>
      <ConnectFacebook />
    </Suspense>
  );
}
