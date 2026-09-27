"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/navigation/TopBar";
import { FloatingNav } from "@/components/navigation/FloatingNav";
import { CommandPalette } from "@/components/navigation/CommandPalette";
import { LoadingSkeleton } from "@/components/ui/States/States";
import styles from "./dashboard.module.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

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

  useEffect(() => {
    const handleScroll = () => {
      const currentScroll = window.scrollY || document.documentElement.scrollTop;
      setIsScrolled(currentScroll > 12);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (isLoading) {
    return (
      <div style={{ padding: "48px", maxWidth: "600px", margin: "100px auto" }}>
        <LoadingSkeleton lines={4} height="200px" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className={styles.shell}>
      {/* Root Apple-grade progressive blur (spans 100vw across side place + navbar) */}
      <div
        className={`${styles.progressiveBlurContainer} ${isScrolled ? styles.progressiveBlurActive : ""}`}
        aria-hidden="true"
      >
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurFilter} />
        <div className={styles.blurGradient} />
      </div>

      <FloatingNav
        userRole={session.role}
        permissions={session.permissions}
        tenantName={session.tenant?.name}
        userName={session.user?.name}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      <div className={styles.mainWrapper}>
        <TopBar
          tenantName={session.tenant?.name}
          userName={session.user?.name}
          userRole={session.role}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />
        <main className={styles.mainContent}>{children}</main>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        permissions={session.permissions}
      />
    </div>
  );
}

