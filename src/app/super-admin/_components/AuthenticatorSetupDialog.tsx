"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { PlatformApiError, platformRequest } from "../_lib/platform-client";
import styles from "../super-admin.module.css";

type Stage = "password" | "key" | "done";

/**
 * Lets a signed-in operator set up their own authenticator from the profile menu (FX-15), without waiting for a
 * high-risk action to ask for one. Same routes as the step-up prompt: the password again (/mfa/enroll), then a code
 * from the app (/mfa/confirm). MFA stays off until the code is accepted.
 */
export const AuthenticatorSetupDialog: React.FC<{ open: boolean; onClose: () => void; onEnrolled: () => void }> = ({
  open,
  onClose,
  onEnrolled,
}) => {
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing (above all the setup key) survives closing the dialog
  useEffect(() => {
    if (!open) {
      setStage("password");
      setPassword("");
      setCode("");
      setEnrollment(null);
      setError(null);
    }
  }, [open]);

  const fail = (err: unknown) => {
    setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "The request failed.");
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await platformRequest<{ secret: string; otpauth_uri: string }>("/api/v1/platform/auth/mfa/enroll", {
        method: "POST",
        json: { password },
      });
      setEnrollment(res.data);
      setStage("key");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformRequest("/api/v1/platform/auth/mfa/confirm", { method: "POST", json: { code } });
      setEnrollment(null);
      setStage("done");
      onEnrolled();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setCode("");
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Set up authenticator">
      <div className={styles.sectionGap}>
        {stage === "password" && (
          <form
            className={styles.sectionGap}
            onSubmit={(e) => {
              e.preventDefault();
              if (password && !busy) void start();
            }}
          >
            <p className={styles.hint}>
              Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password. After setup,
              signing in and high-risk actions ask for a code from the app. Confirm your password to begin.
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
            <div className={styles.inlineActions}>
              <Button size="sm" type="submit" isLoading={busy} disabled={!password}>
                Continue
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {stage === "key" && enrollment && (
          <form
            className={styles.sectionGap}
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6 && !busy) void confirm();
            }}
          >
            <p className={styles.hint}>
              In the app, add an account and type this setup key (or open the link on your phone). Then enter the
              6-digit code the app shows. The key is shown only now.
            </p>
            <dl className={styles.definition}>
              <dt>Setup key</dt>
              <dd className={styles.mono}>{enrollment.secret.replace(/(.{4})(?=.)/g, "$1 ")}</dd>
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
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </label>
            <div className={styles.inlineActions}>
              <Button size="sm" type="submit" isLoading={busy} disabled={code.length !== 6}>
                Turn on authenticator
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {stage === "done" && (
          <>
            <p role="status">
              Authenticator is on. From your next sign-in, you will be asked for a code from the app after your
              password. Keep the app on a device you control: there are no recovery codes for operator accounts yet.
            </p>
            <div className={styles.inlineActions}>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}

        {error && (
          <span className={styles.fieldError} role="alert">
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
};
