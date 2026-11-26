import React from "react";
import type { MixPart } from "./control-tower-view";
import styles from "./control-tower.module.css";

/**
 * A ring split into parts, drawn to scale with a small gap between them. The numbers always appear in text beside
 * it (the caller's legend), because the light fills don't reach 3:1 against the card.
 */
export const Donut: React.FC<{
  parts: readonly MixPart[];
  label: string;
  thickness?: number;
  children?: React.ReactNode;
  className?: string;
}> = ({ parts, label, thickness = 20, children, className }) => {
  const r = 60 - thickness / 2 - 1;
  const circumference = 2 * Math.PI * r;
  const sum = parts.reduce((n, p) => n + p.value, 0);
  const gap = parts.length > 1 ? 2.5 : 0;
  let at = 0;
  return (
    <div className={`${styles.donut} ${className ?? ""}`}>
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--console-inset)" strokeWidth={thickness} />
        {sum > 0 &&
          parts.map((p) => {
            const length = (p.value / sum) * circumference;
            const arc = (
              <circle
                key={p.key}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
                strokeDashoffset={-at}
              />
            );
            at += length;
            return arc;
          })}
      </svg>
      {children && <div className={styles.donutCenter}>{children}</div>}
    </div>
  );
};
