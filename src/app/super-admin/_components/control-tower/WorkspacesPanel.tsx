import React from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { formatCount } from "../../_lib/format";
import { Donut } from "./Donut";
import styles from "./control-tower.module.css";

/** Workspaces by status on the lavender panel. Dark ink in both themes; the counts are always printed. */
export const WorkspacesPanel: React.FC<{ tenants: PlatformOverviewMetrics["tenants"] }> = ({ tenants: t }) => {
  const known = t.active + t.trial + t.suspended + t.archived;
  const parts = [
    { key: "active", label: "Active", value: t.active, color: "var(--console-on-accent-chip)" },
    { key: "trial", label: "Trial", value: t.trial, color: "var(--console-lime)" },
    { key: "suspended", label: "Suspended", value: t.suspended, color: "var(--console-ring-danger)" },
    { key: "archived", label: "Archived", value: t.archived, color: "var(--console-ring-muted)" },
    { key: "other", label: "Other", value: Math.max(0, t.total - known), color: "var(--console-lavender-ink)" },
  ];
  const shown = parts.filter((p) => p.key !== "other" || p.value > 0);
  return (
    <BentoCard span={3} className={styles.workspaces} title="Workspaces">
      <Donut
        parts={shown.filter((p) => p.value > 0)}
        thickness={13}
        className={styles.workspacesDonut}
        label={`${formatCount(t.total)} workspaces: ${shown.map((p) => `${formatCount(p.value)} ${p.label.toLowerCase()}`).join(", ")}`}
      >
        <strong>{formatCount(t.total)}</strong>
        <span>workspaces</span>
      </Donut>
      <ul className={styles.quad} aria-hidden="true">
        {shown.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <strong>{formatCount(p.value)}</strong>
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
    </BentoCard>
  );
};
