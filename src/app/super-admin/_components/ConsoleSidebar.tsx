"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, KeyRound, LogOut, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, ShieldAlert, ShieldCheck, Sun, X } from "lucide-react";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import { LogoMark } from "@/components/brand/LogoMark";
import { usePlatformSession } from "../_lib/platform-session";
import { useConsoleTheme } from "../_lib/console-theme";
import { sidebarModules, type ConsoleModule, type ConsoleSection } from "../_lib/console-modules";
import { CONSOLE_ROOT, canAccessPlatformPath } from "../_lib/platform-module-access";
import { isTabActive, moduleCount, tabCount, waitingWork, type NavCount } from "../_lib/sidebar-view";
import { formatCount, humanize } from "../_lib/format";
import styles from "./ConsoleSidebar.module.css";

const SECTIONS: readonly ConsoleSection[] = ["Operate", "Govern", "Analyse"];

/** "Platform Super Admin" gives "PS"; an email gives its first letter. */
function initialsOf(name: string): string {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}
const COLLAPSED_KEY = "commerceos.console.sidebar";

export interface ConsoleSidebarProps {
  /** The attention list; null while unknown, so no counts are drawn. */
  items: AttentionItem[] | null;
  /** Below 768px the sidebar is a drawer, opened from the top bar. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  mfaEnrolled: boolean;
  onSetUpAuthenticator: () => void;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
}

function isModuleActive(pathname: string, m: ConsoleModule): boolean {
  return pathname === m.href || (m.match === "prefix" && pathname.startsWith(`${m.href}/`));
}

function Count({ value, what }: { value: NavCount | null; what: string }) {
  if (!value || value.count === 0) return null;
  return (
    <span className={`${styles.count} ${value.urgent ? styles.countUrgent : ""}`} aria-label={`${formatCount(value.count)} ${what}`}>
      {formatCount(value.count)}
    </span>
  );
}

function Entry({ module: m, items, open, onToggle }: { module: ConsoleModule; items: AttentionItem[] | null; open: boolean; onToggle: () => void }) {
  const pathname = usePathname() ?? "";
  const tab = useSearchParams()?.get("tab") ?? null;
  const active = isModuleActive(pathname, m);
  const tabs = m.tabs ?? [];
  const childrenId = `sidebar-${m.href.replace(/[^a-z0-9]+/gi, "-")}`;
  const what = m.href === CONSOLE_ROOT ? "items need attention" : "items need attention here";

  return (
    <li>
      <div className={styles.row}>
        <Link href={m.href} className={`${styles.item} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
          <span className={styles.icon}>{m.icon}</span>
          <span className={styles.label}>{m.label}</span>
          {items && <Count value={moduleCount(items, m.href)} what={what} />}
          <span className={styles.tooltip} aria-hidden="true">
            {m.label}
          </span>
        </Link>
        {tabs.length > 1 && (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={`${open ? "Hide" : "Show"} ${m.label} pages`}
            onClick={onToggle}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {tabs.length > 1 && open && (
        <ul className={styles.children} id={childrenId}>
          {tabs.map((t) => {
            const on = isTabActive(pathname, tab, m.href, t.id, tabs[0].id);
            return (
              <li key={t.id}>
                <Link href={`${m.href}?tab=${t.id}`} className={`${styles.child} ${on ? styles.childActive : ""}`} aria-current={on ? "page" : undefined}>
                  <span>{t.label}</span>
                  {items && <Count value={tabCount(items, m.href, t.id)} what="items need attention here" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function Account({ mfaEnrolled, onSetUpAuthenticator, onSignOut, onSignOutEverywhere }: Pick<ConsoleSidebarProps, "mfaEnrolled" | "onSetUpAuthenticator" | "onSignOut" | "onSignOutEverywhere">) {
  const { session } = usePlatformSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = session.user.name || session.user.email;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.account} ref={ref}>
      <button
        type="button"
        className={styles.me}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu, ${name}, ${humanize(session.role)}${mfaEnrolled ? "" : ", no authenticator set up"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar}>{initialsOf(name)}</span>
        <span className={styles.who}>
          <strong>{name}</strong>
          {mfaEnrolled ? <span>{humanize(session.role)}</span> : <span className={styles.warn}>No authenticator</span>}
        </span>
        <MoreHorizontal size={16} className={styles.more} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHead}>
            <strong>{name}</strong>
            <span>{session.user.email}</span>
          </div>
          <div className={styles.menuNote}>
            {session.mfaVerified ? <ShieldCheck size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
            {session.mfaVerified ? "Signed in with MFA" : "Signed in without MFA"}
          </div>
          <div className={styles.menuNote}>
            <KeyRound size={16} aria-hidden="true" />
            Role: {humanize(session.role)}
          </div>
          {!mfaEnrolled && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setOpen(false); onSetUpAuthenticator(); }}>
              <ShieldAlert size={16} aria-hidden="true" />
              Set up authenticator
            </button>
          )}
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onSignOutEverywhere}>
            <LogOut size={16} aria-hidden="true" />
            Sign out everywhere
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "collapsed";
  } catch {
    return false; // storage blocked: start expanded
  }
}

/**
 * The console sidebar: modules in three sections with the role's tabs, counts from the attention list, the work
 * waiting for an operator, the theme switch and the account menu. It can collapse to an icon rail (remembered in this
 * browser); below 768px it is a drawer opened from the top bar.
 */
export const ConsoleSidebar: React.FC<ConsoleSidebarProps> = (props) => {
  const { items, drawerOpen, onCloseDrawer } = props;
  const { session } = usePlatformSession();
  const { theme, toggle: toggleTheme } = useConsoleTheme();
  const pathname = usePathname() ?? "";
  const modules = sidebarModules(session.permissions);
  const [collapsed, setCollapsed] = useState(false);
  const narrow = useNarrow();
  // The drawer on a phone always shows labels
  const rail = collapsed && !narrow;
  const [openHrefs, setOpenHrefs] = useState<Set<string>>(new Set());
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setCollapsed(storedCollapsed()), []);

  // The module in view shows its pages; the others keep what the operator chose
  useEffect(() => {
    const current = modules.find((m) => isModuleActive(pathname, m));
    if (current?.tabs?.length) setOpenHrefs((prev) => (prev.has(current.href) ? prev : new Set(prev).add(current.href)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The drawer closes on navigation, and on Escape; focus moves into it when it opens
  useEffect(() => {
    onCloseDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseDrawer();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, onCloseDrawer]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, v ? "expanded" : "collapsed");
      } catch {
        // not remembered, but the switch still works for this visit
      }
      return !v;
    });
  };

  const toggleGroup = (href: string) =>
    setOpenHrefs((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });

  const waiting = items ? waitingWork(items) : null;
  const approvalsHref = `${CONSOLE_ROOT}/security?tab=approvals`;
  const handoversHref = `${CONSOLE_ROOT}/ai?tab=hitl`;
  const showApprovals = Boolean(waiting && waiting.approvals > 0 && canAccessPlatformPath(approvalsHref, session.permissions));
  const showHandovers = Boolean(waiting && waiting.handovers > 0 && canAccessPlatformPath(handoversHref, session.permissions));

  return (
    <>
      {drawerOpen && <button type="button" className={styles.scrim} aria-label="Close navigation" onClick={onCloseDrawer} />}
      <nav
        className={`${styles.sidebar} ${rail ? styles.collapsed : ""} ${drawerOpen ? styles.drawerOpen : ""}`}
        aria-label="Platform console navigation"
      >
        <div className={styles.head}>
          <Link href={CONSOLE_ROOT} className={styles.brand} aria-label="CommerceOS platform console home">
            <LogoMark size={32} />
            <span className={styles.brandText}>
              <strong>CommerceOS</strong>
              <span>Platform console</span>
            </span>
          </Link>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.collapseButton}`}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <button type="button" ref={closeRef} className={`${styles.iconButton} ${styles.closeButton}`} onClick={onCloseDrawer} aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.scroll}>
          {SECTIONS.map((section) => {
            const entries = modules.filter((m) => m.section === section);
            if (entries.length === 0) return null;
            return (
              <div key={section} className={styles.section}>
                <h2 className={styles.sectionTitle}>{section}</h2>
                <ul className={styles.list}>
                  {entries.map((m) => (
                    <Entry key={m.href} module={m} items={items} open={!rail && openHrefs.has(m.href)} onToggle={() => toggleGroup(m.href)} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {(showApprovals || showHandovers) && waiting && (
          <div className={styles.waiting}>
            <span className={styles.waitingTitle}>Waiting for an operator</span>
            <div className={styles.waitingLinks}>
              {showApprovals && (
                <Link href={approvalsHref} aria-label={`${formatCount(waiting.approvals)} approval requests waiting`}>
                  <strong>{formatCount(waiting.approvals)}</strong>
                  <span>approvals</span>
                </Link>
              )}
              {showHandovers && (
                <Link href={handoversHref} aria-label={`${formatCount(waiting.handovers)} handovers past SLA`}>
                  <strong>{formatCount(waiting.handovers)}</strong>
                  <span>handovers</span>
                </Link>
              )}
            </div>
          </div>
        )}

        <div className={styles.foot}>
          <Account {...props} />
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
        </div>
      </nav>
    </>
  );
};

/** useSearchParams needs a Suspense boundary; the fallback is the same sidebar without the tab highlight. */
export const ConsoleSidebarBoundary: React.FC<ConsoleSidebarProps> = (props) => (
  <Suspense fallback={null}>
    <ConsoleSidebar {...props} />
  </Suspense>
);
