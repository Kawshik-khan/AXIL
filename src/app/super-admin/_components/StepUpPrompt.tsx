"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { PlatformApiError, platformRequest } from "../_lib/platform-client";
import { usePlatformSession } from "../_lib/platform-session";
import styles from "../super-admin.module.css";

type Stage = "code" | "enroll-password" | "enroll-confirm";

/**
 * Step-up for HIGH/CRITICAL actions: a fresh authenticator code → a 5-minute token held in memory. An operator
 * without an authenticator enrolls here first (password again, then the secret, then a code).
 */
export const StepUpPrompt: React.FC<{ onGranted: (token: string) => void; onCancel?: () => void }> = ({ onGranted, onCancel }) => {
  const { grantStepUp } = usePlatformSession();
  const [stage, setStage] = useState<Stage>("code");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => {
    setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "The request failed.");
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await platformRequest<{ stepUpToken: string; expires_in: number }>("/api/v1/platform/auth/step-up", {
        method: "POST",
        json: { code },
      });
      grantStepUp(res.data.stepUpToken, res.data.expires_in);
      onGranted(res.data.stepUpToken);
    } catch (err) {
      if (err instanceof PlatformApiError && err.code === "MFA_NOT_ENROLLED") {
        setStage("enroll-password");
        setError(null);
      } else {
        fail(err);
      }
    } finally {
      setBusy(false);
      setCode("");
    }
  };

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await platformRequest<{ secret: string; otpauth_uri: string }>("/api/v1/platform/auth/mfa/enroll", {
        method: "POST",
        json: { password },
      });
      setEnrollment(res.data);
      setStage("enroll-confirm");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  const confirmEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformRequest("/api/v1/platform/auth/mfa/confirm", { method: "POST", json: { code } });
      setEnrollment(null);
      setStage("code");
      setCode("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.sectionGap}>
      {stage === "code" && (
        <>
          <label className={styles.field}>
            Authenticator code
            <span className={styles.hint}>This action needs a fresh code. The approval lasts 5 minutes.</span>
            <input
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </label>
          <div className={styles.inlineActions}>
            <Button size="sm" onClick={verify} isLoading={busy} disabled={code.length !== 6}>
              Verify
            </Button>
            {onCancel && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}

      {stage === "enroll-password" && (
        <>
          <p className={styles.hint}>
            You have no authenticator yet. Confirm your password to set one up; step-up needs it for high-risk actions.
          </p>
          <label className={styles.field}>
            Password
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          <Button size="sm" onClick={startEnrollment} isLoading={busy} disabled={!password}>
            Continue
          </Button>
        </>
      )}

      {stage === "enroll-confirm" && enrollment && (
        <>
          <p className={styles.hint}>Add this key to your authenticator app, then enter the code it shows.</p>
          <dl className={styles.definition}>
            <dt>Setup key</dt>
            <dd className={styles.mono}>{enrollment.secret}</dd>
            <dt>Link</dt>
            <dd>
              <a href={enrollment.otpauth_uri} className={styles.mono}>
                Open in authenticator
              </a>
            </dd>
          </dl>
          <label className={styles.field}>
            Code from the app
            <input
              className={styles.input}
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </label>
          <Button size="sm" onClick={confirmEnrollment} isLoading={busy} disabled={code.length !== 6}>
            Turn on authenticator
          </Button>
        </>
      )}

      {error && (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
};
