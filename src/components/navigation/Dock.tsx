"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Settings, LogOut } from "lucide-react";
import styles from "./FloatingNav.module.css";

export interface DockItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  /** "exact" (default) lights the item only on its own path; "prefix" also on nested paths. */
  match?: "exact" | "prefix";
}

export interface DockProps {
  items: DockItem[];
  ariaLabel?: string;
  /** Opens the command palette; the search button is hidden without it. */
  onSearch?: () => void;
  /** The settings link; hidden when absent (e.g. the role can't read settings). */
  settingsHref?: string;
  onLogout: () => void;
}

function isActive(pathname: string, item: { href: string; match?: "exact" | "prefix" }): boolean {
  if (pathname === item.href) return true;
  return item.match === "prefix" && pathname.startsWith(`${item.href}/`);
}

/**
 * The floating dock shared by the merchant dashboard and the platform console: one column of circular buttons,
 * a divider, then search, settings and log-out. Callers decide which items a role may see.
 */
export const Dock: React.FC<DockProps> = ({
  items,
  ariaLabel = "Floating Dock Navigation",
  onSearch,
  settingsHref,
  onLogout,
}) => {
  const pathname = usePathname() ?? "";

  return (
    <nav className={styles.dockWrapper} aria-label={ariaLabel}>
      <div className={styles.dockPill}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.dockCircle} ${active ? styles.activeCircle : styles.inactiveCircle}`}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <div className={styles.iconContainer}>{item.icon}</div>
              <span className={styles.dockTooltip}>{item.label}</span>
              {item.badge && !active && <span className={styles.circleDot} />}
            </Link>
          );
        })}

        <div className={styles.dockDivider} />

        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            className={`${styles.dockCircle} ${styles.inactiveCircle}`}
            aria-label="Search (Cmd+K)"
            title="Search (Cmd+K)"
          >
            <div className={styles.iconContainer}>
              <Search size={19} strokeWidth={2} />
            </div>
            <span className={styles.dockTooltip}>Search (⌘K)</span>
          </button>
        )}

        {settingsHref && (
          <Link
            href={settingsHref}
            className={`${styles.dockCircle} ${
              pathname === settingsHref ? styles.activeCircle : styles.inactiveCircle
            }`}
            aria-label="Settings"
            title="Settings"
          >
            <div className={styles.iconContainer}>
              <Settings size={20} strokeWidth={2} />
            </div>
            <span className={styles.dockTooltip}>Settings</span>
          </Link>
        )}

        <button
          type="button"
          onClick={onLogout}
          className={`${styles.dockCircle} ${styles.inactiveCircle} ${styles.logoutCircle}`}
          aria-label="Log Out"
          title="Log Out"
        >
          <div className={styles.iconContainer}>
            <LogOut size={18} strokeWidth={2} />
          </div>
          <span className={styles.dockTooltip}>Log Out</span>
        </button>
      </div>
    </nav>
  );
};
