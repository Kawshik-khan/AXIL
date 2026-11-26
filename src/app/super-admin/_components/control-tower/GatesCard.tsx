import React from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { canAccessPlatformPath } from "../../_lib/platform-module-access";
import { isPresent } from "../../_lib/format";
import { postureGates, type GateTone } from "./control-tower-view";
import { GateTag } from "./SeverityMark";
import styles from "./control-tower.module.css";

const RING: Record<GateTone, string> = {
  ok: "var(--console-lavender-mark)",
  info: "var(--console-lavender-mark)",
  warn: "var(--color-warning-ink)",
  bad: "var(--color-danger-ink)",
  none: "var(--console-line-strong)",
};

const R = 17;
const C = 2 * Math.PI * R;

/** The five gates as rings. Only MFA coverage is a share; the other rings are whole and carry the state colour. */
export const GatesCard: React.FC<{
  overview: PlatformOverviewMetrics;
  items: readonly AttentionItem[] | null;
  permissions: readonly string[];
}> = ({ overview, items, permissions }) => {
  const mfa = overview.security.mfa_enforced_percent;
  return (
    <BentoCard span={3} className={styles.card} title="Gates" subtitle="Current platform state">
      <ul className={styles.gates}>
        {postureGates(overview, items).map((g) => {
          const share = g.label === "Operators with MFA" && isPresent(mfa) ? mfa / 100 : 1;
          const body = (
            <>
              <span className={styles.ring}>
                <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r={R} fill="none" stroke="var(--console-line-strong)" strokeWidth="4" />
                  {share > 0 && (
                    <circle
                      cx="20"
                      cy="20"
                      r={R}
                      fill="none"
                      stroke={RING[g.tone]}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${share * C} ${C}`}
                    />
                  )}
                </svg>
                <span>{g.value}</span>
              </span>
              <span className={styles.gateText}>
                <b>{g.label}</b>
                <GateTag tone={g.tone} label={g.state} />
              </span>
            </>
          );
          return (
            <li key={g.label}>
              {canAccessPlatformPath(g.href, permissions) ? (
                <Link href={g.href} className={styles.gate}>
                  {body}
                </Link>
              ) : (
                <div className={styles.gate}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </BentoCard>
  );
};
