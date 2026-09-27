"use client";

import React, { useEffect, useState } from "react";
import styles from "./login.module.css";

type ApiErrorBody = { error?: { message?: string; request_id?: string } } | null;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody;
  const message = body?.error?.message || fallback;
  return body?.error?.request_id ? `${message} (request ${body.error.request_id})` : message;
}

/**
 * Platform operator sign-in (audit C3/C8, FX-04, FX-15).
 * Step 1: POST /api/v1/platform/auth/login checks the password with bcrypt.
 * Step 2 (operators with an authenticator): POST /api/v1/platform/auth/mfa/verify checks the TOTP code.
 * The session lives in an httpOnly cookie and is never exposed to this page.
 */
export default function PlatformLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in → go straight to the console.
  useEffect(() => {
    fetch("/api/v1/platform/auth/session", { credentials: "same-origin" })
      .then((res) => {
        if (res.ok) window.location.assign("/super-admin");
      })
      .catch(() => undefined);
  }, []);

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Sign-in failed."));
      const body = (await res.json()) as { data?: { mfa_required?: boolean; mfa_token?: string } };
      if (body.data?.mfa_required && body.data.mfa_token) {
        setMfaToken(body.data.mfa_token);
        setPassword("");
        setSubmitting(false);
        return;
      }
      window.location.assign("/super-admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setSubmitting(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/platform/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mfa_token: mfaToken, code: code.trim() }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "The code could not be verified."));
      window.location.assign("/super-admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The code could not be verified.");
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>Platform Control Plane</h1>
          <p className={styles.subtitle}>
            {mfaToken ? "Enter the 6-digit code from your authenticator app." : "Sign in with your platform operator account."}
          </p>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {mfaToken ? (
          <form className={styles.form} onSubmit={handleCode}>
            <label className={styles.field}>
              Authenticator code
              <input
                className={styles.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
              />
            </label>
            <button className={styles.submit} type="submit" disabled={submitting || code.length !== 6}>
              {submitting ? "Verifying…" : "Verify and sign in"}
            </button>
            <button
              className={styles.link}
              type="button"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different account
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handlePassword}>
            <label className={styles.field}>
              Email
              <input
                className={styles.input}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              Password
              <input
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        <p className={styles.footnote}>
          High-risk actions ask for a fresh authenticator code. Set up your authenticator from the console&apos;s step-up
          prompt.
        </p>
      </div>
    </main>
  );
}
