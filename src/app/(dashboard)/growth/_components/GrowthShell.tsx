"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import styles from "./Growth.module.css";

const TABS = [
  { href: "/growth", label: "Overview" },
  { href: "/growth/audiences", label: "Audiences" },
  { href: "/growth/cart-recovery", label: "Cart recovery" },
] as const;

export type GrowthTab = (typeof TABS)[number]["href"];

interface GrowthShellProps {
  active: GrowthTab;
  title: string;
  subtitle: string;
  /** Buttons at the header's right */
  actions?: React.ReactNode;
  /** Small counts beside a tab ("Cart recovery 2") */
  counts?: Partial<Record<GrowthTab, number | null>>;
  children: React.ReactNode;
}

/**
 * The Growth area's frame: page header and the Overview / Audiences / Cart recovery tabs. Journeys, A/B Experiments,
 * Campaigns, Broadcasts and Attribution were removed (2026-11-26); Lifecycle lives under Customers.
 */
export function GrowthShell({ active, title, subtitle, actions, counts, children }: GrowthShellProps) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        {actions && <div className={styles.controls}>{actions}</div>}
      </header>

      <nav className={styles.tabs} aria-label="Growth">
        {TABS.map((tab) => {
          const count = counts?.[tab.href];
          return (
            <Link key={tab.href} href={tab.href} className={styles.tab} aria-current={tab.href === active ? "page" : undefined}>
              {tab.label}
              {typeof count === "number" && count > 0 && <span className={styles.tabCount}>{count.toLocaleString()}</span>}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

interface PanelProps {
  title: string;
  note?: React.ReactNode;
  /** Controls or a link at the panel's top right */
  actions?: React.ReactNode;
  /** The lilac surface (one per screen) */
  lilac?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** A white card (or the screen's lilac one): title, optional note and actions, then its content. */
export function Panel({ title, note, actions, lilac = false, className = "", children }: PanelProps) {
  return (
    <section className={`${styles.card} ${styles.panel} ${lilac ? styles.attention : ""} ${className}`} aria-label={title}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{title}</h2>
          {note && <div className={styles.note}>{note}</div>}
        </div>
        {actions && <div className={styles.controls}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export interface Feedback {
  tone: "ok" | "error";
  text: string;
}

/** A dismissible result line under the tabs. */
export function FeedbackToast({ feedback, onClose }: { feedback: Feedback | null; onClose: () => void }) {
  if (!feedback) return null;
  return (
    <div className={`${styles.toast} ${feedback.tone === "ok" ? styles.toastOk : styles.toastError}`} role="status">
      {feedback.tone === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{feedback.text}</span>
      <button type="button" className={styles.toastClose} onClick={onClose} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
