"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  BarChart3,
  BellRing,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  PackageMinus,
  Send,
  Truck,
  Unplug,
  Users,
} from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Modal } from "@/components/ui/Modal/Modal";
import { Switch } from "@/components/ui/Switch/Switch";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import styles from "./NotificationsPanel.module.css";

type AlertKey = "daily_summary" | "low_stock" | "failed_deliveries" | "cod_weekly";

interface SettingsView {
  bot: { configured: boolean; username: string | null };
  telegram: { connected: boolean; chat_label: string | null; linked_at: string | null; paused: boolean };
  alerts: Record<AlertKey, boolean>;
  pending_link_expires_at: string | null;
  last_test_at: string | null;
  can_manage: boolean;
}

interface ApiError {
  message: string;
  requestId?: string;
  status: number;
}

const ALERTS: Array<{ key: AlertKey; title: string; when: string; description: string; icon: React.ReactNode }> = [
  {
    key: "daily_summary",
    title: "Daily summary",
    when: "Every day · 9:00 PM",
    description: "Today's orders, revenue, pending orders and items running low.",
    icon: <BarChart3 size={18} />,
  },
  {
    key: "low_stock",
    title: "Low-stock alert",
    when: "Every day · 8:00 AM",
    description: "Items at or below their reorder point, with a suggested quantity. Nothing is ordered for you.",
    icon: <PackageMinus size={18} />,
  },
  {
    key: "failed_deliveries",
    title: "Failed & returned deliveries",
    when: "Once a day",
    description: "Parcels that failed or came back, so you can call the customer before re-sending.",
    icon: <Truck size={18} />,
  },
  {
    key: "cod_weekly",
    title: "Weekly COD check",
    when: "Once a week",
    description: "Cash-on-delivery orders delivered per courier, to check against each payout.",
    icon: <Banknote size={18} />,
  },
];

const POLL_MS = 3000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err: ApiError = { status: res.status, message: body?.error?.message ?? "Something went wrong.", requestId: body?.error?.request_id };
    throw err;
  }
  return body?.data as T;
}

const asError = (err: unknown): ApiError =>
  typeof err === "object" && err && "status" in err ? (err as ApiError) : { status: 0, message: "Couldn't reach CommerceOS. Check your connection." };

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

function secondsLeft(iso: string | null): number {
  return iso ? Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000)) : 0;
}

/**
 * Settings → Notifications: connect a Telegram chat to the CommerceOS alerts bot (one tap, then Start in Telegram)
 * and choose which owner alerts arrive there. Every state is handled: loading, error (with reference), no permission,
 * read-only, not set up on the server, not connected, waiting for Start, connected.
 */
export function NotificationsPanel() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState<AlertKey | null>(null);
  const [waiting, setWaiting] = useState<{ url: string; expiresAt: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [action, setAction] = useState<"connect" | "group" | "test" | "disconnect" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const wasConnected = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoadError(null);
    try {
      const data = await call<SettingsView>("/api/v1/notifications/settings");
      setView(data);
      if (data.telegram.connected && !wasConnected.current && quiet) {
        setWaiting(null);
        setNotice({ tone: "success", text: `Connected to ${data.telegram.chat_label}. Alerts will arrive there.` });
      }
      wasConnected.current = data.telegram.connected;
    } catch (err) {
      if (!quiet) setLoadError(asError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While waiting for Start in Telegram: check every few seconds, and count down the link's lifetime
  useEffect(() => {
    if (!waiting) return;
    setCountdown(secondsLeft(waiting.expiresAt));
    const poll = setInterval(() => void load(true), POLL_MS);
    const tick = setInterval(() => {
      const left = secondsLeft(waiting.expiresAt);
      setCountdown(left);
      if (left === 0) {
        setWaiting(null);
        setNotice({ tone: "error", text: "The link expired before Start was pressed. Connect again to get a new one." });
      }
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [waiting, load]);

  const connect = async (kind: "connect" | "group") => {
    setAction(kind);
    setNotice(null);
    try {
      const link = await call<{ url: string; group_url: string; expires_at: string }>("/api/v1/notifications/telegram/link", { method: "POST" });
      const url = kind === "group" ? link.group_url : link.url;
      setWaiting({ url, expiresAt: link.expires_at });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setNotice({ tone: "error", text: asError(err).message });
    } finally {
      setAction(null);
    }
  };

  const toggle = async (key: AlertKey, on: boolean) => {
    if (!view) return;
    const before = view.alerts[key];
    setSaving(key);
    setView({ ...view, alerts: { ...view.alerts, [key]: on } }); // reversible: put back if the save fails
    try {
      const data = await call<{ alerts: Record<AlertKey, boolean> }>("/api/v1/notifications/settings", {
        method: "PATCH",
        body: JSON.stringify({ alerts: { [key]: on } }),
      });
      setView((v) => (v ? { ...v, alerts: data.alerts } : v));
    } catch (err) {
      setView((v) => (v ? { ...v, alerts: { ...v.alerts, [key]: before } } : v));
      setNotice({ tone: "error", text: `Couldn't save: ${asError(err).message}` });
    } finally {
      setSaving(null);
    }
  };

  const sendTest = async () => {
    setAction("test");
    setNotice(null);
    try {
      await call("/api/v1/notifications/test", { method: "POST" });
      setNotice({ tone: "success", text: "Test message sent. Check Telegram." });
      void load(true);
    } catch (err) {
      setNotice({ tone: "error", text: asError(err).message });
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction("disconnect");
    setNotice(null);
    try {
      await call("/api/v1/notifications/telegram", { method: "DELETE" });
      setConfirmDisconnect(false);
      setNotice({ tone: "success", text: "Disconnected. Alerts are no longer sent to Telegram." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: asError(err).message });
    } finally {
      setAction(null);
    }
  };

  if (loadError?.status === 403) return <PermissionDenied resource="notification settings" requiredPermission="settings.read" />;
  if (loadError) {
    return <ErrorState title="Couldn't load notifications" message={loadError.message} requestId={loadError.requestId} onRetry={() => void load()} />;
  }
  if (!view) {
    return (
      <BentoGrid>
        <BentoCard span={7}>
          <LoadingSkeleton lines={5} />
        </BentoCard>
        <BentoCard span={5}>
          <LoadingSkeleton lines={5} />
        </BentoCard>
        <BentoCard span={12}>
          <LoadingSkeleton lines={4} />
        </BentoCard>
      </BentoGrid>
    );
  }

  const readOnly = !view.can_manage;
  const enabledCount = ALERTS.filter((a) => view.alerts[a.key]).length;

  return (
    <div className={styles.panel}>
      <div className={styles.live} role="status" aria-live="polite">
        {notice && (
          <div className={`${styles.notice} ${notice.tone === "success" ? styles.noticeSuccess : styles.noticeError}`}>
            {notice.tone === "success" ? <CheckCircle2 size={16} /> : <BellRing size={16} />}
            <span>{notice.text}</span>
            <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>

      <BentoGrid>
        <BentoCard span={7} className={styles.connectCard}>
          <div className={styles.connectHead}>
            <div className={`${styles.brandIcon} ${view.telegram.connected ? styles.brandIconOn : ""}`}>
              <Send size={22} />
            </div>
            <div className={styles.connectTitles}>
              <div className={styles.eyebrow}>Telegram alerts</div>
              <h3 className={styles.connectTitle}>
                {view.telegram.connected ? "Your shop alerts are on" : "Get shop alerts on your phone"}
              </h3>
            </div>
            <span className={`${styles.statusPill} ${view.telegram.connected ? styles.statusOn : waiting ? styles.statusWaiting : styles.statusOff}`}>
              <span className={styles.statusDot} />
              {view.telegram.connected ? "Connected" : waiting ? "Waiting for Start" : "Not connected"}
            </span>
          </div>

          {!view.bot.configured ? (
            <p className={styles.muted}>
              Telegram alerts aren&apos;t set up on this CommerceOS server yet. Your platform administrator needs to add the alerts
              bot; your choices below are saved and start working as soon as it is.
            </p>
          ) : view.telegram.connected ? (
            <>
              <div className={styles.chatRow}>
                <div className={styles.chatAvatar}>{(view.telegram.chat_label ?? "T").replace("@", "").slice(0, 1).toUpperCase()}</div>
                <div>
                  <div className={styles.chatName}>{view.telegram.chat_label}</div>
                  <div className={styles.chatMeta}>
                    Connected {formatDate(view.telegram.linked_at)}
                    {view.last_test_at ? ` · last test ${formatDate(view.last_test_at)}` : ""}
                  </div>
                </div>
              </div>
              {view.telegram.paused && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="status">
                  Alerts are paused: the person who connected this chat no longer has access to this shop. Disconnect and
                  connect again to resume them.
                </p>
              )}
              {!readOnly && (
                <div className={styles.actions}>
                  <Button variant="primary" onClick={() => void sendTest()} disabled={action !== null}>
                    {action === "test" ? <Loader2 size={16} className={styles.spin} /> : <Send size={16} />}
                    Send test message
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={action !== null}>
                    <Unplug size={16} />
                    Disconnect
                  </Button>
                </div>
              )}
            </>
          ) : waiting ? (
            <div className={styles.waiting}>
              <div className={styles.pulse} aria-hidden="true" />
              <div>
                <div className={styles.waitingTitle}>Press Start in Telegram</div>
                <p className={styles.muted}>
                  Telegram opened in a new tab. Press <strong>Start</strong> there and this page updates by itself.
                </p>
                <div className={styles.waitingMeta}>
                  <Clock size={14} />
                  Link works for {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                </div>
                <div className={styles.actions}>
                  <a className={styles.linkButton} href={waiting.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={16} />
                    Open Telegram again
                  </a>
                  <Button variant="ghost" onClick={() => setWaiting(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <ol className={styles.steps}>
                <li>
                  <span className={styles.stepNo}>1</span>
                  <span>Tap <strong>Connect Telegram</strong></span>
                </li>
                <li>
                  <span className={styles.stepNo}>2</span>
                  <span>Press <strong>Start</strong> in the chat that opens</span>
                </li>
                <li>
                  <span className={styles.stepNo}>3</span>
                  <span>That&apos;s it: alerts arrive there</span>
                </li>
              </ol>
              {readOnly ? (
                <p className={styles.muted}>Ask a workspace owner or admin to connect Telegram.</p>
              ) : (
                <div className={styles.actions}>
                  <Button variant="primary" size="lg" onClick={() => void connect("connect")} disabled={action !== null}>
                    {action === "connect" ? <Loader2 size={18} className={styles.spin} /> : <Send size={18} />}
                    Connect Telegram
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => void connect("group")} disabled={action !== null}>
                    {action === "group" ? <Loader2 size={18} className={styles.spin} /> : <Users size={18} />}
                    Use a team group
                  </Button>
                </div>
              )}
            </>
          )}
        </BentoCard>

        <BentoCard span={5} className={styles.previewCard} title="What a message looks like" subtitle="Example layout: your real numbers go in">
          <div className={styles.phone}>
            <div className={styles.bubble}>
              <div className={styles.bubbleTitle}>📊 Your shop · today</div>
              <div className={styles.bubbleLine}>Orders · cancelled</div>
              <div className={styles.bubbleLine}>Revenue in ৳</div>
              <div className={styles.bubbleLine}>Pending orders</div>
              <div className={styles.bubbleLine}>Items running low</div>
              <div className={styles.bubbleTime}>9:00 PM</div>
            </div>
            <div className={`${styles.bubble} ${styles.bubbleSecond}`}>
              <div className={styles.bubbleTitle}>⚠️ Items low on stock</div>
              <div className={styles.bubbleLine}>Name (SKU): left · reorder ~qty</div>
              <div className={styles.bubbleTime}>8:00 AM</div>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          span={12}
          title="Alerts"
          subtitle={`${enabledCount} of ${ALERTS.length} on${view.telegram.connected ? "" : " · they start arriving once Telegram is connected"}`}
        >
          <ul className={styles.alertList}>
            {ALERTS.map((a) => {
              const on = view.alerts[a.key];
              const switchId = `alert-${a.key}`;
              return (
                <li key={a.key} className={`${styles.alertRow} ${on ? styles.alertOn : ""}`}>
                  <div className={styles.alertIcon}>{a.icon}</div>
                  <div className={styles.alertText}>
                    <label htmlFor={switchId} className={styles.alertTitle}>
                      {a.title}
                    </label>
                    <p className={styles.alertDescription}>{a.description}</p>
                  </div>
                  <span className={styles.when}>
                    <Clock size={12} />
                    {a.when}
                  </span>
                  <Switch
                    id={switchId}
                    label={a.title}
                    checked={on}
                    disabled={readOnly}
                    busy={saving === a.key}
                    onChange={(next) => void toggle(a.key, next)}
                  />
                </li>
              );
            })}
          </ul>
          {readOnly && <p className={styles.footnote}>You can see these settings; only an owner or admin can change them.</p>}
        </BentoCard>
      </BentoGrid>

      <Modal isOpen={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect Telegram?">
        <p className={styles.muted}>
          Alerts stop going to <strong>{view.telegram.chat_label}</strong>. Your alert choices are kept, and you can reconnect
          anytime.
        </p>
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void disconnect()} disabled={action === "disconnect"}>
            {action === "disconnect" ? <Loader2 size={16} className={styles.spin} /> : <Unplug size={16} />}
            Disconnect
          </Button>
        </div>
      </Modal>
    </div>
  );
}
