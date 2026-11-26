"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Menu, Search } from "lucide-react";
import { usePlatformSession } from "../_lib/platform-session";
import { formatCountdown, formatDhakaTime } from "../_lib/format";
import { CONSOLE_ROOT } from "../_lib/platform-module-access";
import { PENDING_APPROVALS_PAGE } from "../_lib/use-pending-approvals";
import { StatusPill } from "./StatusPill";
import styles from "../super-admin.module.css";

export interface PlatformTopBarProps {
  onOpenCommandPalette: () => void;
  /** Opens the sidebar drawer (below 768px, where the sidebar is hidden). */
  onOpenNavigation: () => void;
  navigationOpen: boolean;
  /** Pending approval requests from the approvals API; null while unknown or not permitted. */
  pendingApprovals: number | null;
}

/**
 * The console's top bar: search (⌘K), the step-up countdown, waiting approvals and the time in Dhaka. The account
 * menu and the theme switch live at the foot of the sidebar.
 */
export const PlatformTopBar: React.FC<PlatformTopBarProps> = ({ onOpenCommandPalette, onOpenNavigation, navigationOpen, pendingApprovals }) => {
  const { stepUp } = usePlatformSession();
  const [now, setNow] = useState(() => Date.now());

  // One clock tick a second drives the Dhaka time and the step-up countdown
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The hook reads one page of requests, so a full page means "this many or more"
  const approvalCount =
    pendingApprovals !== null && pendingApprovals >= PENDING_APPROVALS_PAGE ? `${PENDING_APPROVALS_PAGE}+` : pendingApprovals;

  return (
    <header className={styles.topBar}>
      <button
        type="button"
        className={`${styles.topIcon} ${styles.topMenu}`}
        onClick={onOpenNavigation}
        aria-label="Open navigation"
        aria-expanded={navigationOpen}
      >
        <Menu size={19} aria-hidden="true" />
      </button>

      <button type="button" className={styles.topSearch} onClick={onOpenCommandPalette} aria-label="Open command palette">
        <Search size={16} aria-hidden="true" />
        <span className={styles.topSearchText}>Search tenants or jump to a module</span>
        <kbd className={styles.topKbd}>⌘K</kbd>
      </button>

      <div className={styles.topRight}>
        {stepUp && (
          <span title="Step-up verification is active for privileged actions">
            <StatusPill status="ACTIVE" tone="info" label={`Step-up ${formatCountdown(new Date(stepUp.expiresAt).toISOString(), now)}`} />
          </span>
        )}
        {pendingApprovals !== null && pendingApprovals > 0 && (
          <Link
            href={`${CONSOLE_ROOT}/security?tab=approvals`}
            className={styles.topIcon}
            aria-label={`${approvalCount} approval requests waiting`}
            title={`${approvalCount} approval requests waiting`}
          >
            <ClipboardCheck size={19} aria-hidden="true" />
            <span className={styles.topCount} aria-hidden="true">
              {approvalCount}
            </span>
          </Link>
        )}
        <span className={styles.topClock} title="Bangladesh time (Asia/Dhaka)" suppressHydrationWarning>
          {formatDhakaTime(new Date(now))} Dhaka
        </span>
      </div>
    </header>
  );
};
