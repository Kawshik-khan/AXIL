"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Badge } from "@/components/ui/Badge/Badge";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import styles from "./Security.module.css";

interface MfaStatus {
  enrolled: boolean;
  enrolled_at: string | null;
  recovery_codes_left: number;
  step_up_enforced: boolean;
}

type Stage = "idle" | "password" | "scan" | "codes";

interface ApiBody<T> {
  data?: T;
  error?: { message?: string; request_id?: string };
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiBody<T>;
  return res.ok ? { ok: true, data: json.data } : { ok: false, message: json.error?.message ?? "The request failed." };
}

/** Group a base32 secret in fours so it can be typed into an app by hand. */
const groupSecret = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Settings → Security: the signed-in person's authenticator (FX-97 Part A). Setup asks for the password again, shows
 * the key once, turns on after a valid code, then shows the 10 recovery codes once.
 */
export const AuthenticatorPanel: React.FC<{ impersonating?: boolean }> = ({ impersonating = false }) => {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/v1/auth/mfa", { credentials: "include", cache: "no-store" });
      const json = (await res.json()) as ApiBody<MfaStatus>;
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Couldn't load your authenticator status.");
      setStatus(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load your authenticator status.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post<{ secret: string; otpauth_uri: string }>("/api/v1/auth/mfa/enroll", { password });
    setBusy(false);
    setPassword("");
    if (!res.ok || !res.data) {
      setError(res.message ?? "Couldn't start setup.");
      return;
    }
    setEnrollment(res.data);
    setStage("scan");
  };

  const confirmSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post<{ recovery_codes: string[] }>("/api/v1/auth/mfa/confirm", { code: code.trim() });
    setBusy(false);
    setCode("");
    if (!res.ok || !res.data) {
      setError(res.message ?? "That code didn't work. Try the newest code from your app.");
      return;
    }
    setEnrollment(null);
    setRecoveryCodes(res.data.recovery_codes);
    setStage("codes");
    load();
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const cancel = () => {
    setStage("idle");
    setPassword("");
    setCode("");
    setEnrollment(null);
    setError(null);
  };

  if (loadError) return <ErrorState inline title="Authenticator" message={loadError} onRetry={load} />;
  if (!status) return <LoadingSkeleton lines={2} height="96px" />;

  return (
    <section className={styles.card} aria-labelledby="authenticator-title">
      <div className={styles.row}>
        <ShieldCheck size={18} aria-hidden="true" />
        <h3 id="authenticator-title" className={styles.title}>
          Authenticator app
        </h3>
        {status.enrolled ? <Badge variant="success">On</Badge> : <Badge variant="pending">Not set up</Badge>}
      </div>

      {stage === "idle" && status.enrolled && (
        <p className={styles.text}>
          On since {status.enrolled_at ? new Date(status.enrolled_at).toLocaleDateString() : "setup"}.{" "}
          {status.recovery_codes_left} of 10 recovery codes left. Approvals and other high-risk actions ask for a code
          {status.step_up_enforced ? "." : " once your workspace turns this on."}
        </p>
      )}

      {stage === "idle" && !status.enrolled && (
        <>
          <p className={styles.text}>
            Approving broadcasts, campaigns, price changes and similar actions will ask for a code from an authenticator
            app such as Google Authenticator, Microsoft Authenticator or 1Password.
            {status.step_up_enforced ? " Your workspace already requires it, so set it up before your next approval." : ""}
          </p>
          {impersonating ? (
            <p className={styles.text}>Only the account&apos;s owner can set this up.</p>
          ) : (
            <div>
              <Button type="button" variant="primary" onClick={() => setStage("password")}>
                Set up authenticator
              </Button>
            </div>
          )}
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {stage === "password" && (
        <form className={styles.stack} onSubmit={startSetup}>
          <p className={styles.text}>Enter your password to start.</p>
          <Input
            id="mfa-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={busy} disabled={!password}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {stage === "scan" && enrollment && (
        <form className={styles.stack} onSubmit={confirmSetup}>
          <p className={styles.text}>
            Add this key to your authenticator app. On this phone you can{" "}
            <a className={styles.link} href={enrollment.otpauth_uri}>
              open it in the app
            </a>
            ; on a computer, choose &quot;enter a setup key&quot; in the app and type:
          </p>
          <code className={styles.secret}>{groupSecret(enrollment.secret)}</code>
          <Input
            id="mfa-confirm-code"
            label="6-digit code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={busy} disabled={code.length !== 6}>
              Turn on
            </Button>
          </div>
        </form>
      )}

      {stage === "codes" && (
        <div className={styles.stack}>
          <p className={styles.text}>
            Your authenticator is on. Save these recovery codes somewhere safe: each works once if you lose your phone,
            and they won&apos;t be shown again.
          </p>
          <ul className={styles.codes}>
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={copyCodes}>
              {copied ? "Copied" : "Copy codes"}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setRecoveryCodes([]);
                setStage("idle");
              }}
            >
              I&apos;ve saved them
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
