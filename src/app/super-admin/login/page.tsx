"use client";

import React, { useEffect, useState } from "react";
import styles from "./login.module.css";

/**
 * Platform operator sign-in (audit C3/C8, FX-04).
 * POST /api/v1/platform/auth/login verifies the password with bcrypt and sets the httpOnly platform session
 * cookie; the token is never exposed to this page. There is no header- or environment-based way in.
 */
export default function PlatformLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const handleSubmit = async (e: React.FormEvent) => {
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
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string; request_id?: string } } | null;
        const message = body?.error?.message || "Sign-in failed.";
        throw new Error(body?.error?.request_id ? `${message} (request ${body.error.request_id})` : message);
      }
      window.location.assign("/super-admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>Platform Control Plane</h1>
          <p className={styles.subtitle}>Sign in with your platform operator account.</p>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
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

        <p className={styles.footnote}>
          High-risk actions also require step-up verification, which is not available yet.
        </p>
      </div>
    </main>
  );
}
