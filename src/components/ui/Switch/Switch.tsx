"use client";

import React from "react";
import styles from "./Switch.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when there is no visible label tied to the switch. */
  label: string;
  disabled?: boolean;
  /** Shows a spinner in the thumb while a save is in flight. */
  busy?: boolean;
  size?: "sm" | "md";
  id?: string;
}

/** An on/off switch: a button with role="switch", operable with Space and Enter, with a visible focus ring. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled = false, busy = false, size = "md", id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-busy={busy || undefined}
    disabled={disabled || busy}
    onClick={() => onChange(!checked)}
    className={`${styles.switch} ${styles[size]} ${checked ? styles.on : ""}`}
  >
    <span className={styles.thumb} aria-hidden="true">
      {busy && <span className={styles.spinner} />}
    </span>
  </button>
);
