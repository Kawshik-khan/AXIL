"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IsoGrid } from "@/components/marketing/IsoGrid";
import { LockScene } from "../LockScene";
import styles from "../stage.module.css";

/**
 * Workspace sign-in. One light stage: the isometric grid fills the page, the lock scene on the left follows the attempt
 * (see LockScene; on success its lines light up, then the grid flashes), and the form floats on the right as a
 * frosted-glass card.
 * The request itself is unchanged: POST /api/v1/auth/login, then the dashboard.
 */

type Status = "idle" | "submitting" | "success" | "error";
type ErrorField = "email" | "password";

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

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Desktop only: on phones, focusing a field on load throws the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia("(min-width: 861px)").matches) emailRef.current?.focus();
  }, []);

  const fail = (message: string, field: ErrorField) => {
    setError(message);
    setErrorField(field);
    setStatus("error");
    setShake((n) => n + 1);
  };

  // After a failure, put the cursor back where the fix is. This runs after the fields are enabled again.
  useEffect(() => {
    if (shake) (errorField === "email" ? emailRef : passwordRef).current?.focus();
  }, [shake, errorField]);

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
      const data: unknown = await res.json().catch(() => null);
      const serverMessage =
        typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: { message?: unknown } }).error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : undefined;
      const { message, field } = describeFailure(res.status, res.headers.get("Retry-After"), serverMessage);
      fail(message, field);
      return;
    }

    // The padlock opens and the shutter rolls up, the grid flashes, then the dashboard opens.
    setStatus("success");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) window.setTimeout(() => setFlash((n) => n + 1), 450);
    window.setTimeout(() => {
      window.location.href = "/";
    }, reduce ? 0 : 1250);
  };

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const busy = status === "submitting" || status === "success";

  return (
    <main className={`${styles.page} ${status === "success" ? styles.unlocked : ""}`}>
      <IsoGrid flash={flash} />

      <header className={styles.top}>
        <Link href="/welcome" className={styles.brandMark}>
          <span className={styles.logo}>C✦</span> CommerceOS
        </Link>
        <Link href="/welcome" className={styles.back}>
          <span aria-hidden="true">←</span> Back to site
        </Link>
      </header>

      <div className={styles.stage}>
        <LockScene status={status} />

        <div className={styles.cardWrap}>
        <div key={shake} className={`${styles.card} ${shake ? styles.shake : ""}`}>
          <h1>Sign in</h1>

          <div className={styles.alertSlot} aria-live="assertive">
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
          </div>

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
        </div>
        </div>
      </div>
    </main>
  );
}
