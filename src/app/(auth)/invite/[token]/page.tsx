"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import styles from "../../auth.module.css";

interface InvitationInfo {
  email: string;
  role: string;
  workspace_name: string;
  expires_at: string;
  /** true when the account already exists and must confirm with its password */
  existing_account: boolean;
}

/**
 * Accept an invitation (FX-37): new people choose a name and password; an existing account confirms with its own
 * password; a provisioned workspace owner sets theirs (audit N8).
 */
export default function AcceptInvitationPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/invitations/${encodeURIComponent(params.token)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error?.message || "This invitation can't be used.");
        setInfo(json.data as InvitationInfo);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "This invitation can't be used."));
  }, [params.token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/invitations/${encodeURIComponent(params.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info?.existing_account ? { password } : { name, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Couldn't accept the invitation.");
      window.location.href = "/"; // the response signed you in
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't accept the invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.header}>
          <div className={styles.brandLogo}>C✦</div>
          <h1 className={styles.title}>Join a workspace</h1>
          <p className={styles.subtitle}>
            {info ? (
              <>
                You&apos;ve been invited to <strong>{info.workspace_name}</strong> as {info.role} ({info.email}).
              </>
            ) : loadError ? (
              "This invitation can't be used."
            ) : (
              "Checking your invitation…"
            )}
          </p>
        </div>

        {(loadError || error) && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              backgroundColor: "var(--color-danger-bg)",
              color: "var(--color-danger)",
              borderRadius: "var(--radius-control)",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            {loadError || error}
          </div>
        )}

        {info && (
          <form className={styles.form} onSubmit={handleSubmit}>
            {!info.existing_account && (
              <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            )}
            <Input
              label={info.existing_account ? "Your account password" : "Choose a password (8+ characters)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={info.existing_account ? 1 : 8}
            />
            <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
              Accept invitation
            </Button>
          </form>
        )}

        <p className={styles.footerText}>
          Already a member?{" "}
          <Link href="/login" className={styles.link}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
