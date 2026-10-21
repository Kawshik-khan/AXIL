"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, RefreshCw } from "lucide-react";
import { LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { handOffSignInToOpener, popupQueryOf } from "@/components/social/meta-login-popup";
import type { ConnectedChannel } from "@/types/social";
import styles from "../facebook/facebook.module.css";

type NumberState = "NOT_CONNECTED" | "CONNECTED_HERE" | "IN_ANOTHER_WORKSPACE";
interface PickableNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  waba_id: string;
  quality_rating?: string;
  state: NumberState;
}
type Outcome = "CONNECTED" | "RECONNECTED" | "CONNECTED_NOT_REGISTERED" | "CONNECTED_NEEDS_ATTENTION" | "IN_ANOTHER_WORKSPACE" | "FAILED";
interface ConnectResult {
  phone_number_id: string;
  display_phone_number: string;
  outcome: Outcome;
  webhooks_subscribed: boolean;
  registered: boolean | null;
  error?: string;
}

/** Short codes from the callback redirect; Meta's own text never travels in the URL. */
const CALLBACK_ERRORS: Record<string, string> = {
  WHATSAPP_DENIED: "WhatsApp sign-up was cancelled. Nothing was connected.",
  WHATSAPP_STATE_INVALID: "That sign-up link expired or was opened in another browser. Start again.",
  WHATSAPP_LOGIN_NOT_CONFIGURED: "WhatsApp sign-up isn't set up on this server yet. Ask your administrator to add the Meta app settings.",
  META_LOGIN_NOT_CONFIGURED: "WhatsApp sign-up isn't set up on this server yet. Ask your administrator to add the Meta app settings.",
  META_TOKEN_INVALID: "The sign-up expired. Start again.",
  META_UNREACHABLE: "Meta could not be reached. Try again.",
  FORBIDDEN: "Your role can't connect channels.",
};

const STATE_LABEL: Record<NumberState, string> = {
  NOT_CONNECTED: "Not connected",
  CONNECTED_HERE: "Connected (will refresh)",
  IN_ANOTHER_WORKSPACE: "In another workspace",
};
const OUTCOME_LABEL: Record<Outcome, string> = {
  CONNECTED: "Connected",
  RECONNECTED: "Refreshed",
  CONNECTED_NOT_REGISTERED: "Saved, number not registered yet",
  CONNECTED_NEEDS_ATTENTION: "Saved, not working yet",
  IN_ANOTHER_WORKSPACE: "Connected to another workspace",
  FAILED: "Failed",
};

function ConnectWhatsApp() {
  const params = useSearchParams();
  const [inPopup] = useState(() => handOffSignInToOpener("whatsapp", popupQueryOf(new URLSearchParams(params.toString()))));
  const [numbers, setNumbers] = useState<PickableNumber[] | null>(null);
  const [selected, setSelected] = useState("");
  const [pin, setPin] = useState("");
  const [channels, setChannels] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("error");
    return code ? CALLBACK_ERRORS[code] ?? "WhatsApp sign-up didn't finish. Start again." : null;
  });
  const [forbidden, setForbidden] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/v1/social/channels").catch(() => null);
    if (res?.status === 403) setForbidden(true);
    if (!res?.ok) return;
    const json = await res.json();
    const list: ConnectedChannel[] = json.data?.channels ?? json.data ?? [];
    setChannels(Array.isArray(list) ? list.filter((c) => c.type === "WHATSAPP") : []);
  }, []);

  const loadNumbers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/connections/whatsapp/pending/resources");
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) setForbidden(true);
      if (!res.ok) {
        setNumbers(null);
        // 404 = no sign-up yet: show the Connect button, not an error
        if (res.status !== 404 && res.status !== 403) setError(json?.error?.message ?? "Could not load your WhatsApp numbers.");
        return;
      }
      const list: PickableNumber[] = json.data?.numbers ?? [];
      setNumbers(list);
      const free = list.filter((n) => n.state !== "IN_ANOTHER_WORKSPACE");
      setSelected(free.length === 1 ? free[0].id : "");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (inPopup) return;
    loadChannels();
    loadNumbers();
  }, [inPopup, loadChannels, loadNumbers]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/connections/whatsapp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: [] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 403 ? CALLBACK_ERRORS.FORBIDDEN : json?.error?.message ?? "Could not start WhatsApp sign-up.");
        return;
      }
      const url = String(json.data?.url ?? "");
      if (!url.startsWith("https://www.facebook.com/")) {
        setError("Could not start WhatsApp sign-up.");
        return;
      }
      window.location.href = url;
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
      const res = await fetch("/api/v1/connections/whatsapp/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number_id: selected, ...(pin ? { pin } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not connect the number.");
        return;
      }
      setResult((json.data.results as ConnectResult[])[0] ?? null);
      setNumbers(null);
      setPin("");
      loadChannels();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (inPopup) {
    return (
      <div className={styles.page}>
        <p className={styles.muted}>WhatsApp sign-up finished. You can close this window.</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className={styles.page}>
        <PermissionDenied resource="WhatsApp channels" requiredPermission="social.channel.manage" />
      </div>
    );
  }

  const ok = (o: Outcome) => o === "CONNECTED" || o === "RECONNECTED";
  const pinValid = pin === "" || /^\d{6}$/.test(pin);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <MessageCircle size={22} /> Connect WhatsApp
        </h1>
        <p className={styles.subtitle}>
          Sign up with Meta to connect your WhatsApp Business number. Customer messages arrive in the inbox and your team
          replies from CommerceOS. You need a phone number that isn&apos;t used in the WhatsApp app.
        </p>
      </header>

      {error && <p className={styles.alert} role="alert">{error}</p>}

      {result && (
        <section className={styles.card} aria-label="Connection result">
          <h2 className={styles.cardTitle}>Result</h2>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${ok(result.outcome) ? styles.badgeOk : styles.badgeBad}`}>
              {result.display_phone_number || result.phone_number_id}: {OUTCOME_LABEL[result.outcome]}
            </span>
            <span className={`${styles.badge} ${result.webhooks_subscribed ? styles.badgeOk : styles.badgeBad}`}>
              {result.webhooks_subscribed ? "Receiving messages" : "Not receiving messages"}
            </span>
            {result.registered !== null && (
              <span className={`${styles.badge} ${result.registered ? styles.badgeOk : styles.badgeBad}`}>
                {result.registered ? "Number registered" : "Number not registered"}
              </span>
            )}
          </div>
          {result.error && <p className={styles.muted}>{result.error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.ghostButton} onClick={start} disabled={busy}>Connect another number</button>
          </div>
        </section>
      )}

      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : numbers ? (
        <section className={styles.card} aria-label="Choose a number">
          <h2 className={styles.cardTitle}>Choose the number to connect</h2>
          {numbers.length === 0 ? (
            <p className={styles.muted}>This sign-up didn&apos;t give access to any WhatsApp number. Sign up again and finish adding a number.</p>
          ) : (
            <ul className={styles.pageList}>
              {numbers.map((n) => {
                const blocked = n.state === "IN_ANOTHER_WORKSPACE";
                return (
                  <li key={n.id}>
                    <label className={`${styles.pageRow} ${blocked ? styles.pageRowDisabled : ""}`}>
                      <input type="radio" name="wa-number" checked={selected === n.id} disabled={blocked} onChange={() => setSelected(n.id)} />
                      <div>
                        <span className={styles.pageName}>{n.display_phone_number || n.id}</span>
                        <div className={styles.badges}>
                          <span className={styles.badge}>{n.verified_name}</span>
                          <span className={`${styles.badge} ${blocked ? styles.badgeBad : ""}`}>{STATE_LABEL[n.state]}</span>
                          {n.quality_rating && <span className={styles.badge}>Quality {n.quality_rating}</span>}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={styles.field}>
            <label htmlFor="wa-pin" className={styles.fieldLabel}>Two-step verification PIN (6 digits)</label>
            <input
              id="wa-pin"
              type="password"
              className={styles.select}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <p className={styles.muted}>
              Used once to register the number with WhatsApp, never stored. Leave empty if Meta already registered it during sign-up.
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={connect} disabled={busy || !selected || !pinValid}>
              {busy ? "Connecting…" : "Connect number"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={start} disabled={busy}>
              <RefreshCw size={14} /> Sign up again
            </button>
          </div>
        </section>
      ) : (
        !result && (
          <section className={styles.card} aria-label="Connect WhatsApp">
            <h2 className={styles.cardTitle}>Sign up with Meta</h2>
            <ol className={styles.steps}>
              <li>Sign in with the Facebook account that manages your business.</li>
              <li>Create or pick your WhatsApp Business Account and verify your number.</li>
              <li>Come back here, pick the number and confirm.</li>
            </ol>
            <button type="button" className={styles.primaryButton} onClick={start} disabled={busy}>
              <MessageCircle size={16} /> {busy ? "Opening Meta…" : "Connect WhatsApp"}
            </button>
          </section>
        )
      )}

      <section className={styles.card} aria-label="Connected WhatsApp numbers">
        <h2 className={styles.cardTitle}>Connected WhatsApp numbers</h2>
        {channels.length === 0 ? (
          <p className={styles.muted}>None yet.</p>
        ) : (
          <ul className={styles.channelList}>
            {channels.map((c) => (
              <li key={c.id}>
                {c.name} · {c.status === "ACTIVE" ? "Active" : c.status}
                {c.last_webhook_at ? ` · last message ${new Date(c.last_webhook_at).toLocaleString()}` : " · no messages received yet"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ConnectWhatsAppPage() {
  return (
    <Suspense fallback={<LoadingSkeleton lines={4} />}>
      <ConnectWhatsApp />
    </Suspense>
  );
}
