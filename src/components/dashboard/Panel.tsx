import React from "react";
import Link from "next/link";
import styles from "./Dashboard.module.css";

interface PanelProps {
  title: string;
  note?: React.ReactNode;
  /** A link at the panel's top right */
  link?: { href: string; label: string };
  /** Controls at the panel's top right, before the link */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** A white dashboard card: title, optional note, optional controls and link, then its content. */
export const Panel: React.FC<PanelProps> = ({ title, note, link, actions, children }) => (
  <section className={`${styles.card} ${styles.panel}`} aria-label={title}>
    <div className={styles.panelHead}>
      <div className={styles.panelHeadText}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {note && <div className={styles.note}>{note}</div>}
      </div>
      {(actions || link) && (
        <div className={styles.panelActions}>
          {actions}
          {link && (
            <Link href={link.href} className={styles.linkPill}>
              {link.label}
            </Link>
          )}
        </div>
      )}
    </div>
    {children}
  </section>
);

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** Inside a card: a soft track and shorter buttons */
  small?: boolean;
  busy?: boolean;
}

export function Segmented<T extends string>({ label, value, options, onChange, small = false, busy = false }: SegmentedProps<T>) {
  return (
    <div className={`${styles.segmented} ${small ? styles.segmentedSmall : ""}`} role="group" aria-label={label} aria-busy={busy}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A signed percentage change; colour is backed by the arrow and the sign. */
export const Trend: React.FC<{ value: number; suffix?: string }> = ({ value, suffix }) => (
  <>
    <span className={value >= 0 ? styles.trendUp : styles.trendDown}>
      {value >= 0 ? "↗ +" : "↘ "}
      {value}%
    </span>
    {suffix ? ` ${suffix}` : null}
  </>
);
