"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search, LogOut, ShieldCheck, ShieldAlert, KeyRound, LogOut as SignOutAll, ClipboardCheck, Sun, Moon } from "lucide-react";
import Link from "next/link";
import styles from "@/components/navigation/TopBar.module.css";
import { usePlatformSession } from "../_lib/platform-session";
import { formatCountdown, formatDhakaTime, humanize } from "../_lib/format";
import { CONSOLE_ROOT } from "../_lib/platform-module-access";
import { StatusPill } from "./StatusPill";
import { useConsoleTheme } from "../_lib/console-theme";

export interface PlatformTopBarProps {
  onOpenCommandPalette: () => void;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  /** Pending approval requests from the approvals API; null while unknown or not permitted. */
  pendingApprovals: number | null;
}

function initialsOf(text: string): string {
  const parts = text.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export const PlatformTopBar: React.FC<PlatformTopBarProps> = ({
  onOpenCommandPalette,
  onSignOut,
  onSignOutEverywhere,
  pendingApprovals,
}) => {
  const { session, stepUp } = usePlatformSession();
  const { theme, toggle: toggleTheme } = useConsoleTheme();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const menuRef = useRef<HTMLDivElement>(null);

  // One clock tick a second drives the Dhaka time and the step-up countdown
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const displayName = session.user.name || session.user.email;

  return (
    <header className={styles.topBar}>
      <div className={styles.leftSection}>
        <div className={styles.tenantBadge} title="Bangladesh time (Asia/Dhaka)">
          <span>Platform console</span>
          <span suppressHydrationWarning>· {formatDhakaTime(new Date(now))} Dhaka</span>
        </div>
      </div>

      <div className={styles.centerSection}>
        <button className={styles.searchTrigger} onClick={onOpenCommandPalette} aria-label="Open command palette">
          <span className={styles.searchPlaceholder}>
            <Search size={16} />
            <span>Search tenants or jump to a module…</span>
          </span>
          <span className={styles.kbdShortcut}>⌘K</span>
        </button>
      </div>

      <div className={styles.rightSection}>
        {stepUp && (
          <span title="Step-up verification is active for privileged actions">
            <StatusPill status="ACTIVE" tone="info" label={`Step-up ${formatCountdown(new Date(stepUp.expiresAt).toISOString(), now)}`} />
          </span>
        )}

        {pendingApprovals !== null && pendingApprovals > 0 && (
          <Link
            href={`${CONSOLE_ROOT}/security?tab=approvals`}
            className={styles.iconButton}
            aria-label={`${pendingApprovals} approval requests waiting`}
            title={`${pendingApprovals} approval requests waiting`}
          >
            <ClipboardCheck size={18} />
            <span className={styles.notificationBadge} />
          </Link>
        )}

        <button
          type="button"
          className={styles.iconButton}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div className={styles.profileMenuWrapper} ref={menuRef}>
          <button
            className={styles.profileButton}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="true"
          >
            <div className={styles.avatar}>{initialsOf(displayName)}</div>
            <span className={styles.userName}>{displayName}</span>
            <StatusPill status={session.role} tone="neutral" label={humanize(session.role)} />
          </button>

          {open && (
            <div className={styles.dropdown} role="menu">
              <div className={styles.dropdownItem} role="presentation">
                <span>
                  <strong>{displayName}</strong>
                  <br />
                  <span>{session.user.email}</span>
                </span>
              </div>
              <div className={styles.dropdownItem} role="presentation">
                {session.mfaVerified ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                <span>{session.mfaVerified ? "Signed in with MFA" : "Signed in without MFA"}</span>
              </div>
              <div className={styles.dropdownItem} role="presentation">
                <KeyRound size={16} />
                <span>Role: {humanize(session.role)}</span>
              </div>
              <div className={styles.dropdownDivider} />
              <button className={styles.dropdownItem} onClick={onSignOutEverywhere} role="menuitem">
                <SignOutAll size={16} />
                <span>Sign out everywhere</span>
              </button>
              <button className={styles.dropdownItem} onClick={onSignOut} role="menuitem">
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
