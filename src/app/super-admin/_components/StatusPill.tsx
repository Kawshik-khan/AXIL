import React from "react";
import { humanize } from "../_lib/format";
import styles from "./StatusPill.module.css";

export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral" | "simulated";

const TONE_BY_STATUS: Record<string, StatusTone> = {
  ACTIVE: "ok",
  HEALTHY: "ok",
  SUCCESS: "ok",
  RESOLVED: "ok",
  APPROVED: "ok",
  EXECUTED: "ok",
  PUBLISHED: "ok",
  ENABLED: "ok",
  TRIAL: "info",
  DRAFT: "info",
  INVESTIGATING: "warn",
  IDENTIFIED: "warn",
  MONITORING: "warn",
  DEGRADED: "warn",
  PENDING: "warn",
  PAST_DUE: "warn",
  PAUSED: "warn",
  OPEN: "bad",
  DOWN: "bad",
  FAILED: "bad",
  FAILURE: "bad",
  SUSPENDED: "bad",
  REJECTED: "bad",
  BLOCKED: "bad",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  ARCHIVED: "neutral",
  RETIRED: "neutral",
  DISABLED: "neutral",
  SIMULATED: "simulated",
  NOT_SENT: "simulated",
  NOT_VERIFIED: "simulated",
};

/** The tone for an API status value; unknown values are neutral rather than guessed. */
export function toneForStatus(status: string | null | undefined): StatusTone {
  return (status && TONE_BY_STATUS[status.toUpperCase()]) || "neutral";
}

export const StatusPill: React.FC<{ status: string; tone?: StatusTone; label?: string }> = ({ status, tone, label }) => (
  <span className={`${styles.pill} ${styles[tone ?? toneForStatus(status)]}`}>
    <span className={styles.dot} aria-hidden="true" />
    {label ?? humanize(status)}
  </span>
);
