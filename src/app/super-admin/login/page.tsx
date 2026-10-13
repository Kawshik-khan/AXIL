"use client";

import React, { useEffect, useRef, useState } from "react";
import { vault, type Figure } from "@lucasmarkes/hairline";
import { IsoGrid } from "@/components/marketing/IsoGrid";
import { c } from "@/components/marketing/classes";
import styles from "../../(auth)/stage.module.css";

type ApiErrorBody = { error?: { message?: string; request_id?: string } } | null;
type Status = "idle" | "submitting" | "success" | "error";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody;
  const message = body?.error?.message || fallback;
  return body?.error?.request_id ? `${message} (request ${body.error.request_id})` : message;
}

/**
 * Platform operator sign-in (audit C3/C8, FX-04, FX-15), on the same stage as the workspace sign-in but with a vault
 * door instead of the shop and a "Platform" label, so the two are never confused.
 * Step 1: POST /api/v1/platform/auth/login checks the password with bcrypt.
 * Step 2 (operators with an authenticator): POST /api/v1/platform/auth/mfa/verify checks the TOTP code.
 * The session lives in an httpOnly cookie and is never exposed to this page.
 */
export default function PlatformLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const vaultBox = useRef<HTMLDivElement>(null);
  const door = useRef<Figure | null>(null);

  // Already signed in → go straight to the console.
  useEffect(() => {
    fetch("/api/v1/platform/auth/session", { credentials: "same-origin" })
      .then((res) => {
        if (res.ok) window.location.assign("/super-admin");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(min-width: 861px)").matches) emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = vaultBox.current;
    if (!el) return;
    door.current = vault(el, { theme: "light", intensity: 0.7, label: "A vault door" });
    return () => {
      door.current?.destroy();
      door.current = null;
    };
  }, []);

  // The dial spins on its own while a request is out or once access is granted; otherwise it follows the pointer.
  useEffect(() => {
    door.current?.update({ play: status === "submitting" || status === "success" });
  }, [status]);

  // The code step: put the cursor in the code field as soon as it appears.
  useEffect(() => {
    if (mfaToken) codeRef.current?.focus();
  }, [mfaToken]);

  // After a failure, put the cursor back where the fix is. This runs after the fields are enabled again.
  useEffect(() => {
    if (!shake) return;
    (mfaToken ? codeRef : passwordRef).current?.focus();
  }, [shake, mfaToken]);

  const fail = (message: string) => {
    setError(message);
    setStatus("error");
    setShake((n) => n + 1);
  };

  const succeed = () => {
    setStatus("success");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setFlash((n) => n + 1);
    window.setTimeout(() => window.location.assign("/super-admin"), reduce ? 0 : 700);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;
    setError(null);
    setStatus("submitting");
    try {
      const res = await fetch("/api/v1/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        fail(await errorMessage(res, "Sign-in failed."));
        return;
      }
      const body = (await res.json()) as { data?: { mfa_required?: boolean; mfa_token?: string } };
      if (body.data?.mfa_required && body.data.mfa_token) {
        setMfaToken(body.data.mfa_token);
        setPassword("");
        setShowPassword(false);
        setStatus("idle");
        return;
      }
      succeed();
    } catch {
      fail("Couldn't reach CommerceOS. Check your connection and try again.");
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;
    setError(null);
    setStatus("submitting");
    try {
      const res = await fetch("/api/v1/platform/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mfa_token: mfaToken, code: code.trim() }),
      });
      if (!res.ok) {
        setCode("");
        fail(await errorMessage(res, "The code could not be verified."));
        return;
      }
      succeed();
    } catch {
      fail("Couldn't reach CommerceOS. Check your connection and try again.");
    }
  };

  const switchAccount = () => {
    setMfaToken(null);
    setCode("");
    setShowPassword(false);
    setError(null);
    setStatus("idle");
    window.setTimeout(() => emailRef.current?.focus(), 0);
  };

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const busy = status === "submitting" || status === "success";
  const tag = status === "success" ? "Access granted" : status === "submitting" ? (mfaToken ? "Verifying…" : "Checking…") : mfaToken ? "Code required" : "Sealed";

  return (
    <main className={`${styles.page} ${status === "success" ? styles.unlocked : ""}`}>
      <IsoGrid flash={flash} />

      <header className={styles.top}>
        <span className={styles.brandMark}>
          <span className={styles.logo}>C✦</span> CommerceOS
        </span>
        <span className={styles.platformTag}>Platform console</span>
      </header>

      <div className={styles.stage}>
        <div className={`${styles.scene} ${c("on-card")}`} aria-hidden="true">
          <div ref={vaultBox} className={styles.shop} />
          <p className={styles.lockState}>{tag}</p>
        </div>

        <div className={styles.cardWrap}>
          <div key={shake} className={`${styles.card} ${shake ? styles.shake : ""}`}>
            <div className={styles.cardTitle}>
              <h1>{mfaToken ? "Enter your code" : "Operator sign in"}</h1>
              <span className={styles.platformPill}>Platform</span>
            </div>

            <div className={styles.alertSlot} aria-live="assertive">
              {error && (
                <p className={styles.alert} role="alert">
                  {error}
                </p>
              )}
            </div>

            {mfaToken ? (
              <form className={styles.form} onSubmit={handleCode}>
                <div className={styles.field}>
                  <label htmlFor="op-code">Authenticator code</label>
                  <input
                    ref={codeRef}
                    id="op-code"
                    className={styles.codeInput}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="••••••"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    aria-invalid={status === "error" ? true : undefined}
                    required
                    disabled={busy}
                  />
                  <i className={styles.line} aria-hidden="true" />
                </div>
                <button type="submit" className={styles.submit} disabled={busy || code.length !== 6} aria-busy={status === "submitting"}>
                  <span>{status === "success" ? "Access granted…" : status === "submitting" ? "Verifying…" : "Verify and sign in"}</span>
                  {status === "submitting" && <i className={styles.progress} aria-hidden="true" />}
                </button>
                <button type="button" className={styles.textButton} onClick={switchAccount} disabled={busy}>
                  Use a different account
                </button>
              </form>
            ) : (
              /* The fields have no `name`, so a native submit before hydration can never put the password in the URL. */
              <form className={styles.form} onSubmit={handlePassword}>
                <div className={styles.field}>
                  <label htmlFor="op-email">Email</label>
                  <input
                    ref={emailRef}
                    id="op-email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@commerceos.app"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={status === "error" ? true : undefined}
                    required
                    disabled={busy}
                  />
                  <i className={styles.line} aria-hidden="true" />
                </div>

                <div className={styles.field}>
                  <label htmlFor="op-password">Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      ref={passwordRef}
                      id="op-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={onPasswordKey}
                      onKeyUp={onPasswordKey}
                      onBlur={() => setCapsLock(false)}
                      aria-invalid={status === "error" ? true : undefined}
                      aria-describedby={capsLock ? "op-caps" : undefined}
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className={styles.reveal}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                          <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.3 2.5-2.7 3.8M6.4 6.4C4.3 7.8 2.8 9.9 2 12c1 2.5 5 7 10 7 1.7 0 3.2-.5 4.6-1.3M9.9 9.9a3 3 0 004.2 4.2" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                          <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <i className={styles.line} aria-hidden="true" />
                  {capsLock && (
                    <p id="op-caps" className={styles.caps}>
                      Caps Lock is on
                    </p>
                  )}
                </div>

                <button type="submit" className={styles.submit} disabled={busy} aria-busy={status === "submitting"}>
                  <span>{status === "success" ? "Access granted…" : status === "submitting" ? "Signing in…" : "Sign in"}</span>
                  {status === "submitting" && <i className={styles.progress} aria-hidden="true" />}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
