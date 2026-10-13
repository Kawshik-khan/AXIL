"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/navigation/TopBar";
import { FloatingNav } from "@/components/navigation/FloatingNav";
import { CommandPalette } from "@/components/navigation/CommandPalette";
import { ProgressiveBlur } from "@/components/navigation/ProgressiveBlur";
import { PlatformNotices } from "@/components/navigation/PlatformNotices";
import { LoadingSkeleton } from "@/components/ui/States/States";
import styles from "@/components/navigation/Shell.module.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/v1/auth/session", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        setSession(data.data);
      } catch {
        router.push("/login");
      } finally {
        setIsLoading(false);
      }
    }
    loadSession();
  }, [router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isLoading) {
    return (
      <div
        style={{ padding: "48px", maxWidth: "600px", margin: "100px auto" }}
        suppressHydrationWarning
      >
        <LoadingSkeleton lines={4} height="200px" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className={styles.shell} suppressHydrationWarning>
      {/* Root Apple-grade progressive blur (spans 100vw across side place + navbar) */}
      <ProgressiveBlur />

      <FloatingNav
        userRole={session.role}
        permissions={session.permissions}
        tenantName={session.tenant?.name}
        userName={session.user?.name}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      <div className={styles.mainWrapper}>
        {session.impersonation && (
          // Always visible while a platform operator is inside this workspace (FX-34 step 5)
          <div
            role="status"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              padding: "10px 16px",
              background: "var(--color-warning)",
              color: "var(--color-text-primary)",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <span>
              Viewing {session.tenant?.name} as support ({session.impersonation.mode === "READ_ONLY" ? "read-only" : "changes allowed"}) until{" "}
              {new Date(session.impersonation.expires_at).toLocaleTimeString()}
            </span>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/v1/auth/impersonation", { method: "DELETE", credentials: "include" }).catch(() => undefined);
                window.location.href = "/";
              }}
              style={{ background: "transparent", border: "1px solid currentColor", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", color: "inherit" }}
            >
              End session
            </button>
          </div>
        )}
        <TopBar
          tenantName={session.tenant?.name}
          userName={session.user?.name}
          userRole={session.role}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />
        <main className={styles.mainContent}>
          <PlatformNotices />
          {children}
        </main>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        permissions={session.permissions}
      />
    </div>
  );
}

