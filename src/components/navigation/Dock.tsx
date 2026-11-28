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
  /** Other path prefixes that also light this item: pages reached from it that have no dock entry of their own. */
  alsoActiveOn?: string[];
  /**
   * Pages grouped under this hub. With two or more, hovering or focusing the hub opens a flyout listing them; the hub
   * itself links to `href` (the first page the role can open) and lights up while any of its pages is open.
   */
  children?: DockItem[];
}

export interface DockProps {
  items: DockItem[];
  ariaLabel?: string;
  /** Opens the command palette; the search button is hidden without it. */
  onSearch?: () => void;
  /** The settings link; hidden when absent (e.g. the role can't read settings). */
  settingsHref?: string;
  /** Items shown after search, in place of the plain settings link (e.g. a Settings hub with its pages). */
  trailingItems?: DockItem[];
  /** Short labels under each icon. Off by default, so docks that don't ask for them look the same as before. */
  showLabels?: boolean;
  onLogout: () => void;
  /** Stays at the foot of the dock, outside its scrolling column, in place of the log-out button (the account capsule). */
  footer?: React.ReactNode;
}

function isActive(
  pathname: string,
  item: { href: string; match?: "exact" | "prefix"; alsoActiveOn?: string[] }
): boolean {
  if (pathname === item.href) return true;
  if (item.alsoActiveOn?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  return item.match === "prefix" && item.href !== "/" && pathname.startsWith(`${item.href}/`);
}

function isHubActive(pathname: string, item: DockItem): boolean {
  if (item.children?.length) return item.children.some((child) => isActive(pathname, child));
  return isActive(pathname, item);
}

interface DockEntryProps {
  item: DockItem;
  pathname: string;
  showLabels: boolean;
}

const DockEntry: React.FC<DockEntryProps> = ({ item, pathname, showLabels }) => {
  const active = isHubActive(pathname, item);
  const pages = item.children ?? [];
  const hasFlyout = pages.length > 1;
  const flyoutId = `dock-flyout-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={`${styles.dockEntry} ${hasFlyout ? styles.hasFlyout : ""}`}>
      <Link
        href={item.href}
        className={`${styles.dockCircle} ${active ? styles.activeCircle : styles.inactiveCircle}`}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        aria-controls={hasFlyout ? flyoutId : undefined}
        title={hasFlyout || showLabels ? undefined : item.label}
      >
        <div className={styles.iconContainer}>{item.icon}</div>
        {!hasFlyout && <span className={styles.dockTooltip}>{item.label}</span>}
        {item.badge && !active && <span className={styles.circleDot} />}
      </Link>
      {showLabels && (
        <span className={`${styles.dockLabel} ${active ? styles.dockLabelActive : ""}`} aria-hidden="true">
          {item.label}
        </span>
      )}

      {hasFlyout && (
        <div className={styles.flyout} id={flyoutId} role="group" aria-label={`${item.label} pages`}>
          <div className={styles.flyoutTitle}>{item.label}</div>
          <div className={styles.flyoutList}>
            {pages.map((page) => {
              const pageActive = isActive(pathname, page);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className={`${styles.flyoutLink} ${pageActive ? styles.flyoutLinkActive : ""}`}
                  aria-current={pageActive ? "page" : undefined}
                >
                  <span>{page.label}</span>
                  {page.badge && <span className={styles.flyoutBadge}>{page.badge}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The floating dock shared by the merchant dashboard and the platform console: one column of circular buttons,
 * a divider, then search, settings and log-out. Callers decide which items a role may see.
 */
export const Dock: React.FC<DockProps> = ({
  items,
  ariaLabel = "Floating Dock Navigation",
  onSearch,
  settingsHref,
  trailingItems,
  showLabels = false,
  onLogout,
  footer,
}) => {
  const pathname = usePathname() ?? "";

  return (
    <nav className={`${styles.dockWrapper} ${showLabels ? styles.withLabels : ""} ${footer ? styles.withFooter : ""}`} aria-label={ariaLabel}>
      <div className={styles.dockPill}>
        {items.map((item) => (
          <DockEntry key={item.href} item={item} pathname={pathname} showLabels={showLabels} />
        ))}

        <div className={styles.dockDivider} />

        {onSearch && (
          <div className={styles.dockEntry}>
            <button
              type="button"
              onClick={onSearch}
              className={`${styles.dockCircle} ${styles.inactiveCircle}`}
              aria-label="Search (Cmd+K)"
              title={showLabels ? undefined : "Search (Cmd+K)"}
            >
              <div className={styles.iconContainer}>
                <Search size={19} strokeWidth={2} />
              </div>
              <span className={styles.dockTooltip}>Search (⌘K)</span>
            </button>
            {showLabels && (
              <span className={styles.dockLabel} aria-hidden="true">
                Search
              </span>
            )}
          </div>
        )}

        {trailingItems?.map((item) => (
          <DockEntry key={item.href} item={item} pathname={pathname} showLabels={showLabels} />
        ))}

        {!trailingItems && settingsHref && (
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

        {!footer && (
          <div className={styles.dockEntry}>
            <button
              type="button"
              onClick={onLogout}
              className={`${styles.dockCircle} ${styles.inactiveCircle} ${styles.logoutCircle}`}
              aria-label="Log Out"
              title={showLabels ? undefined : "Log Out"}
            >
              <div className={styles.iconContainer}>
                <LogOut size={18} strokeWidth={2} />
              </div>
              <span className={styles.dockTooltip}>Log Out</span>
            </button>
            {showLabels && (
              <span className={styles.dockLabel} aria-hidden="true">
                Log out
              </span>
            )}
          </div>
        )}
      </div>

      {footer}
    </nav>
  );
};
