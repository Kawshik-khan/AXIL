"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IsoGrid } from "@/components/marketing/IsoGrid";
import { LockScene } from "../LockScene";
import styles from "../stage.module.css";

/**
 * Create a store (workspace + owner). Same stage as sign-in: the isometric grid, the shop scene on the left and a
 * frosted-glass form on the right. The tag under the shop shows the store's name as it is typed; when the store is
 * created the shutter rolls up and the dashboard opens.
 * The request is unchanged: POST /api/v1/auth/register with { name, workspaceName, email, password, currency }.
 */

type Status = "idle" | "submitting" | "success" | "error";
type Field = "workspaceName" | "name" | "email" | "password";

const CURRENCIES = [
  { code: "BDT", label: "৳ BDT" },
  { code: "USD", label: "$ USD" },
  { code: "EUR", label: "€ EUR" },
] as const;

const MIN_PASSWORD = 8;

/** What went wrong, in words the person can act on, and which field to put them back in. */
function describeFailure(status: number, retryAfter: string | null, serverMessage: string | undefined): { message: string; field: Field } {
  if (status === 429) {
    const seconds = Number(retryAfter);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null;
    return {
      message: minutes ? `Too many sign-ups right now. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` : "Too many sign-ups right now. Try again later.",
      field: "workspaceName",
    };
  }
  if (status === 409) return { message: serverMessage || "An account with this email address already exists.", field: "email" };
  const message = serverMessage || "Couldn't create your store. Please try again.";
  const lower = message.toLowerCase();
  const field: Field = lower.includes("password") ? "password" : lower.includes("email") ? "email" : lower.includes("full name") ? "name" : "workspaceName";
  return { message, field };
}

export default function RegisterPage() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]["code"]>("BDT");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<Field>("workspaceName");
  const [conflict, setConflict] = useState(false);
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState(0);

  const refs: Record<Field, React.RefObject<HTMLInputElement>> = {
    workspaceName: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  // Desktop only: on phones, focusing a field on load throws the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia("(min-width: 861px)").matches) refs.workspaceName.current?.focus();
  }, []);

  // After a failure, put the cursor back where the fix is. This runs after the fields are enabled again.
  useEffect(() => {
    if (shake) refs[errorField].current?.focus();
  }, [shake, errorField]);

  const fail = (message: string, field: Field, isConflict = false) => {
    setError(message);
    setErrorField(field);
    setConflict(isConflict);
    setStatus("error");
    setShake((n) => n + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;
    setError(null);
    setConflict(false);
    setStatus("submitting");

    let res: Response;
    try {
      res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workspaceName, email, password, currency }),
      });
    } catch {
      fail("Couldn't reach CommerceOS. Check your connection and try again.", "workspaceName");
      return;
    }

    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      const serverMessage =
        typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: { message?: unknown } }).error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : undefined;
      const { message, field } = describeFailure(res.status, res.headers.get("Retry-After"), serverMessage);
      fail(message, field, res.status === 409);
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
  const invalid = (field: Field) => (status === "error" && errorField === field ? true : undefined);
  const storeName = workspaceName.trim();
  const longEnough = password.length >= MIN_PASSWORD;

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
        <LockScene
          status={status}
          tag={{
            idle: storeName || "Your shop",
            busy: "Setting up…",
            done: storeName ? `${storeName} is open` : "Open",
          }}
        />

        <div className={styles.cardWrap}>
          <div key={shake} className={`${styles.card} ${shake ? styles.shake : ""}`}>
            <h1>Create your store</h1>

            <div className={styles.alertSlot} aria-live="assertive">
              {error && (
                <p className={styles.alert} role="alert">
                  {error}
                  {conflict && (
                    <>
                      {" "}
                      <Link href="/login">Sign in instead</Link>
                    </>
                  )}
                </p>
              )}
            </div>

            {/* The fields have no `name`, so a native submit before hydration can never put the password in the URL;
                autocomplete is enough for password managers. */}
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="reg-store">Store name</label>
                <input
                  ref={refs.workspaceName}
                  id="reg-store"
                  type="text"
                  autoComplete="organization"
                  placeholder="e.g. Dhaka Artisan Silk"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  aria-invalid={invalid("workspaceName")}
                  minLength={2}
                  maxLength={80}
                  required
                  disabled={busy}
                />
                <i className={styles.line} aria-hidden="true" />
              </div>

              <div className={styles.pair}>
                <div className={styles.field}>
                  <label htmlFor="reg-name">Your name</label>
                  <input
                    ref={refs.name}
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={invalid("name")}
                    minLength={2}
                    required
                    disabled={busy}
                  />
                  <i className={styles.line} aria-hidden="true" />
                </div>

                <fieldset className={styles.currency} disabled={busy}>
                  <legend>Currency</legend>
                  <div className={styles.segments}>
                    {CURRENCIES.map((cur) => (
                      <label key={cur.code} className={styles.segment}>
                        <input type="radio" name="reg-currency" value={cur.code} checked={currency === cur.code} onChange={() => setCurrency(cur.code)} />
                        <span>{cur.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className={styles.field}>
                <label htmlFor="reg-email">Email</label>
                <input
                  ref={refs.email}
                  id="reg-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@yourstore.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={invalid("email")}
                  required
                  disabled={busy}
                />
                <i className={styles.line} aria-hidden="true" />
              </div>

              <div className={styles.field}>
                <label htmlFor="reg-password">Password</label>
                <div className={styles.passwordRow}>
                  <input
                    ref={refs.password}
                    id="reg-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={onPasswordKey}
                    onKeyUp={onPasswordKey}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={invalid("password")}
                    aria-describedby="reg-password-rule"
                    minLength={MIN_PASSWORD}
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
                <p id="reg-password-rule" className={`${styles.rule} ${longEnough ? styles.ruleMet : ""}`}>
                  {MIN_PASSWORD}+ characters{capsLock ? " · Caps Lock is on" : ""}
                </p>
              </div>

              <button type="submit" className={styles.submit} disabled={busy} aria-busy={status === "submitting"}>
                <span>{status === "success" ? "Your store is open…" : status === "submitting" ? "Creating your store…" : "Create store"}</span>
                {status === "submitting" && <i className={styles.progress} aria-hidden="true" />}
              </button>
            </form>

            <p className={styles.switch}>
              Already have a store? <Link href="/login">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
