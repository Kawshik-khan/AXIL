"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IsoGrid } from "@/components/marketing/IsoGrid";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LockScene } from "../LockScene";
import styles from "../stage.module.css";

/**
 * Workspace sign-in. One light stage: the isometric grid fills the page, the lock scene on the left follows the attempt
 * (see LockScene; on success its lines light up, then the grid flashes), and the form floats on the right as a
 * frosted-glass card.
 * The request itself is unchanged: POST /api/v1/auth/login, then the dashboard.
 * Accounts with an authenticator turned on get a second step: the login answers `mfa_required` with a short-lived
 * token, and POST /api/v1/auth/mfa/verify exchanges it plus the 6-digit code (or a recovery code) for the session.
 */

type Status = "idle" | "submitting" | "success" | "error";
type ErrorField = "email" | "password" | "code";

/** What went wrong, in words the person can act on, and which field to put them back in. */
function describeFailure(status: number, retryAfter: string | null, serverMessage: string | undefined): { message: string; field: ErrorField } {
  if (status === 429) {
    const seconds = Number(retryAfter);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null;
    return {
      message: minutes ? `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` : "Too many sign-in attempts. Try again in a few minutes.",
      field: "email",
    };
  }
  if (status === 401) return { message: serverMessage || "Email or password doesn't match.", field: "password" };
  return { message: serverMessage || "Couldn't sign you in. Please try again.", field: "email" };
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState(0);
  const [errorField, setErrorField] = useState<ErrorField>("email");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Desktop only: on phones, focusing a field on load throws the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia("(min-width: 861px)").matches) emailRef.current?.focus();
  }, []);

  // The code step: put the cursor in the code field as soon as it appears.
  useEffect(() => {
    if (mfaToken) codeRef.current?.focus();
  }, [mfaToken, useRecovery]);

  const fail = (message: string, field: ErrorField) => {
    setError(message);
    setErrorField(field);
    setStatus("error");
    setShake((n) => n + 1);
  };

  // After a failure, put the cursor back where the fix is. This runs after the fields are enabled again.
  useEffect(() => {
    if (shake) (errorField === "email" ? emailRef : errorField === "code" ? codeRef : passwordRef).current?.focus();
  }, [shake, errorField]);

  const succeed = () => {
    // The padlock opens and the shutter rolls up, the grid flashes, then the dashboard opens.
    setStatus("success");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) window.setTimeout(() => setFlash((n) => n + 1), 450);
    window.setTimeout(() => {
      window.location.href = "/";
    }, reduce ? 0 : 1250);
  };

  const readServerMessage = async (res: Response): Promise<string | undefined> => {
    const data: unknown = await res.json().catch(() => null);
    return typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: { message?: unknown } }).error?.message === "string"
      ? (data as { error: { message: string } }).error.message
      : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;
    setError(null);
    setStatus("submitting");

    let res: Response;
    try {
      res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      fail("Couldn't reach CommerceOS. Check your connection and try again.", "email");
      return;
    }

    if (!res.ok) {
      const serverMessage = await readServerMessage(res);
      const { message, field } = describeFailure(res.status, res.headers.get("Retry-After"), serverMessage);
      fail(message, field);
      return;
    }

    // Authenticator turned on: no session yet, ask for the code.
    const body = (await res.json().catch(() => null)) as { data?: { mfa_required?: boolean; mfa_token?: string } } | null;
    if (body?.data?.mfa_required && body.data.mfa_token) {
      setMfaToken(body.data.mfa_token);
      setPassword("");
      setShowPassword(false);
      setCode("");
      setUseRecovery(false);
      setStatus("idle");
      return;
    }

    succeed();
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;
    setError(null);
    setStatus("submitting");
    let res: Response;
    try {
      res = await fetch("/api/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfa_token: mfaToken, code: code.trim() }),
      });
    } catch {
      fail("Couldn't reach CommerceOS. Check your connection and try again.", "code");
      return;
    }
    if (!res.ok) {
      const serverMessage = await readServerMessage(res);
      setCode("");
      if (res.status === 429) {
        fail(describeFailure(429, res.headers.get("Retry-After"), serverMessage).message, "code");
        return;
      }
      // The 5-minute sign-in window ran out: back to email and password.
      if (serverMessage && /expired/i.test(serverMessage)) {
        setMfaToken(null);
        fail(serverMessage, "password");
        return;
      }
      fail(serverMessage || "The code could not be verified.", "code");
      return;
    }
    succeed();
  };

  const switchAccount = () => {
    setMfaToken(null);
    setCode("");
    setUseRecovery(false);
    setError(null);
    setStatus("idle");
    window.setTimeout(() => emailRef.current?.focus(), 0);
  };

  const codeReady = useRecovery ? code.replace(/[\s-]/g, "").length >= 10 : code.length === 6;

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const busy = status === "submitting" || status === "success";

  return (
    <main className={`${styles.page} ${status === "success" ? styles.unlocked : ""}`}>
      <IsoGrid flash={flash} />

      <header className={styles.top}>
        <Link href="/welcome" className={styles.brandMark}>
          <BrandLogo size={34} tile /> CommerceOS
        </Link>
        <Link href="/welcome" className={styles.back}>
          <span aria-hidden="true">←</span> Back to site
        </Link>
      </header>

      <div className={styles.stage}>
        <LockScene status={status} />

        <div className={styles.cardWrap}>
        <div key={shake} className={`${styles.card} ${shake ? styles.shake : ""}`}>
          <h1>{mfaToken ? "Enter your code" : "Sign in"}</h1>

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
                <label htmlFor="login-code">{useRecovery ? "Recovery code" : "Authenticator code"}</label>
                {useRecovery ? (
                  <input
                    ref={codeRef}
                    id="login-code"
                    className={styles.codeInput}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={11}
                    placeholder="XXXXX-XXXXX"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, ""))}
                    aria-invalid={status === "error" ? true : undefined}
                    required
                    disabled={busy}
                  />
                ) : (
                  <input
                    ref={codeRef}
                    id="login-code"
                    className={styles.codeInput}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="••••••"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    aria-invalid={status === "error" ? true : undefined}
                    aria-describedby="login-code-help"
                    required
                    disabled={busy}
                  />
                )}
                <i className={styles.line} aria-hidden="true" />
                {!useRecovery && (
                  <p id="login-code-help" className={styles.caps}>
                    Open your authenticator app and enter the 6-digit code for CommerceOS.
                  </p>
                )}
              </div>
              <button type="submit" className={styles.submit} disabled={busy || !codeReady} aria-busy={status === "submitting"}>
                <span>{status === "success" ? "Unlocked. Opening your store…" : status === "submitting" ? "Verifying…" : "Verify and sign in"}</span>
                {status === "submitting" && <i className={styles.progress} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setCode("");
                  setError(null);
                }}
                disabled={busy}
              >
                {useRecovery ? "Use the authenticator code instead" : "Lost your phone? Use a recovery code"}
              </button>
              <button type="button" className={styles.textButton} onClick={switchAccount} disabled={busy}>
                Use a different account
              </button>
            </form>
          ) : (
          <>
          {/* The fields have no `name`, so a native submit before hydration can never put the password in the URL;
              autocomplete is enough for password managers. */}
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label htmlFor="login-email">Email</label>
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@yourstore.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={status === "error" ? true : undefined}
                required
                disabled={busy}
              />
              <i className={styles.line} aria-hidden="true" />
            </div>

            <div className={styles.field}>
              <label htmlFor="login-password">Password</label>
              <div className={styles.passwordRow}>
                <input
                  ref={passwordRef}
                  id="login-password"
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
                  aria-describedby={capsLock ? "login-caps" : undefined}
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
                <p id="login-caps" className={styles.caps}>
                  Caps Lock is on
                </p>
              )}
            </div>

            <button type="submit" className={styles.submit} disabled={busy} aria-busy={status === "submitting"}>
              <span>{status === "success" ? "Unlocked. Opening your store…" : status === "submitting" ? "Signing in…" : "Sign in"}</span>
              {status === "submitting" && <i className={styles.progress} aria-hidden="true" />}
            </button>
          </form>

          <p className={styles.switch}>
            New here? <Link href="/register">Create your store</Link>
          </p>
          </>
          )}
        </div>
        </div>
      </div>
    </main>
  );
}
