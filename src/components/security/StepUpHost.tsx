"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { registerStepUpPrompt, STEP_UP_ACTION_LABELS, type StepUpRequest } from "@/lib/step-up-client";
import styles from "./Security.module.css";

interface Pending extends StepUpRequest {
  resolve: (token: string | null) => void;
}

/**
 * Mounted once in the dashboard shell. When a request made with `fetchWithStepUp` needs a fresh authenticator code,
 * this asks for one, exchanges it for a 5-minute token bound to that action, and hands the token back.
 */
export const StepUpHost: React.FC = () => {
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    registerStepUpPrompt(
      (request) =>
        new Promise<string | null>((resolve) => {
          pendingRef.current?.resolve(null); // a newer request replaces an unanswered one
          setCode("");
          setError(null);
          setPending({ ...request, resolve });
        })
    );
    return () => registerStepUpPrompt(null);
  }, []);

  const finish = useCallback((token: string | null) => {
    pendingRef.current?.resolve(token);
    setPending(null);
    setCode("");
    setError(null);
  }, []);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim(), action: pending.action }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { stepUpToken?: string }; error?: { message?: string } };
      if (!res.ok || !json.data?.stepUpToken) {
        setError(json.error?.message ?? "That code didn't work. Try the newest code from your app.");
        setCode("");
        return;
      }
      finish(json.data.stepUpToken);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!pending) return null;
  const what = STEP_UP_ACTION_LABELS[pending.action] ?? "continue";

  if (pending.reason === "MFA_ENROLLMENT_REQUIRED") {
    return (
      <Modal isOpen onClose={() => finish(null)} title="Set up an authenticator first">
        <div className={styles.stack}>
          <p className={styles.text}>
            To {what}, you need to confirm with a code from an authenticator app. Your account doesn&apos;t have one yet.
          </p>
          <p className={styles.text}>
            Set it up in{" "}
            <Link className={styles.link} href="/settings#security" onClick={() => finish(null)}>
              Settings → Security
            </Link>
            , then try again.
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={() => finish(null)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={() => finish(null)} title="Confirm with your authenticator">
      <form className={styles.stack} onSubmit={verify}>
        <p className={styles.text}>
          Enter the 6-digit code from your authenticator app to {what}. You can also use a recovery code.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Input
          id="step-up-code"
          label="Code"
          inputMode="text"
          autoComplete="one-time-code"
          maxLength={11}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-F-]/g, ""))}
          autoFocus
          required
        />
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={busy} disabled={code.trim().length < 6}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
};
