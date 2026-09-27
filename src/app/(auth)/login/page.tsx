"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import styles from "../auth.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Invalid login credentials.");
      }

      if (data.data?.platformRole === "SUPER_ADMIN" || data.data?.isPlatformUser) {
        window.location.href = "/super-admin";
      } else {
        window.location.href = "/";
      }
    } catch (err: any) {
      setError(err.message || "Failed to sign in.");
    } finally {
      setIsLoading(false);
    }
  };

  const setDemoCredentials = () => {
    setEmail("admin@commerceos.io");
    setPassword("CommerceOS2026!");
    setError(null);
  };

  const setSuperAdminCredentials = () => {
    setEmail("superadmin@commerceos.io");
    setPassword("Password123!");
    setError(null);
  };

  return (
    <main className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.header}>
          <div className={styles.brandLogo}>C✦</div>
          <h1 className={styles.title}>Welcome to CommerceOS</h1>
          <p className={styles.subtitle}>Enter your credentials to access your store control plane</p>
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "var(--color-danger-bg)",
              color: "var(--color-danger)",
              borderRadius: "var(--radius-control)",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <Input
            label="Email Address"
            type="email"
            placeholder="merchant@store.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
            Sign In to Workspace
          </Button>
        </form>

        <div className={styles.demoBanner} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>💡 Store Owner:</span>
            <span className={styles.demoClickable} onClick={setDemoCredentials}>
              admin@commerceos.io (CommerceOS2026!)
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚡ Super Admin:</span>
            <span className={styles.demoClickable} onClick={setSuperAdminCredentials}>
              superadmin@commerceos.io (Password123!)
            </span>
          </div>
          <div style={{ marginTop: "4px", borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: "6px" }}>
            <Link href="/super-admin" style={{ color: "var(--color-brand-primary)", textDecoration: "none", fontSize: "11px", fontWeight: 700 }}>
              Direct Link: Open Super Admin Control Plane (/super-admin) →
            </Link>
          </div>
        </div>

        <p className={styles.footerText}>
          Don&apos;t have a workspace yet?{" "}
          <Link href="/register" className={styles.link}>
            Create your store
          </Link>
        </p>
      </div>
    </main>
  );
}
