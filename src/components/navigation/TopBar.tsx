"use client";

import React from "react";
import Link from "next/link";
import { Search, Bell, Sun, Moon } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useMerchantTheme } from "./merchant-theme";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  tenantName?: string;
  onOpenCommandPalette?: () => void;
}

/** The merchant top bar: workspace, search, theme and alerts. The signed-in person and log out are at the dock's foot (DockAccount). */
export const TopBar: React.FC<TopBarProps> = ({
  tenantName = "Dhaka D2C Apparel",
  onOpenCommandPalette,
}) => {
  const { theme, toggle: toggleTheme } = useMerchantTheme();

  return (
    <header className={styles.topBar}>
      <div className={styles.leftSection}>
        <Link href="/" className={styles.brandLink} aria-label="CommerceOS home">
          <BrandLogo size={30} label="CommerceOS" />
        </Link>
        <div className={styles.tenantBadge} title="Active Workspace">
          <span className={styles.tenantIcon}>🏢</span>
          <span>{tenantName}</span>
        </div>
      </div>

      <div className={styles.centerSection}>
        <button
          className={styles.searchTrigger}
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
        >
          <span className={styles.searchPlaceholder}>
            <Search size={16} />
            <span>Search or type a command...</span>
          </span>
          <span className={styles.kbdShortcut}>⌘K</span>
        </button>
      </div>

      <div className={styles.rightSection}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button className={styles.iconButton} aria-label="Notifications" title="System Alerts">
          <Bell size={18} />
          <span className={styles.notificationBadge} />
        </button>
      </div>
    </header>
  );
};
