import React from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Diamond, Info } from "lucide-react";
import type { AttentionSeverity } from "@/domains/platform/services/platform-attention.service";
import { humanize } from "../../_lib/format";
import type { GateTone } from "./control-tower-view";
import styles from "./control-tower.module.css";

const SEVERITY: Record<AttentionSeverity, { icon: typeof Circle; tone: string }> = {
  CRITICAL: { icon: AlertOctagon, tone: styles.tagBad },
  HIGH: { icon: AlertTriangle, tone: styles.tagBad },
  MEDIUM: { icon: Diamond, tone: styles.tagWarn },
  LOW: { icon: Info, tone: styles.tagInfo },
};

/** Severity as a chip: shape and word first, colour second. */
export const SeverityTag: React.FC<{ severity: AttentionSeverity }> = ({ severity }) => {
  const { icon: Icon, tone } = SEVERITY[severity];
  return (
    <span className={`${styles.tag} ${tone}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {humanize(severity)}
    </span>
  );
};

const GATE: Record<GateTone, { icon: typeof Circle; tone: string }> = {
  ok: { icon: CheckCircle2, tone: styles.tagOk },
  warn: { icon: Diamond, tone: styles.tagWarn },
  bad: { icon: AlertTriangle, tone: styles.tagBad },
  info: { icon: Info, tone: styles.tagInfo },
  none: { icon: Circle, tone: styles.tagNeutral },
};

export const GateTag: React.FC<{ tone: GateTone; label: string }> = ({ tone, label }) => {
  const { icon: Icon, tone: toneClass } = GATE[tone];
  return (
    <span className={`${styles.tag} ${toneClass}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
};
