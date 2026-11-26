import React from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { StatusPill } from "../StatusPill";
import styles from "./control-tower.module.css";

type Rails = PlatformOverviewMetrics["provider_health"];

const PROVIDER_LABELS: Record<keyof Rails, string> = {
  steadfast_status: "Steadfast courier",
  pathao_status: "Pathao courier",
  bkash_status: "bKash payments",
  meta_status: "Meta messaging",
};

/** Provider status exactly as the overview reports it. */
export const RailsCard: React.FC<{ rails: Rails }> = ({ rails }) => {
  const keys = Object.keys(PROVIDER_LABELS) as Array<keyof Rails>;
  return (
    <BentoCard span={3} className={`${styles.card} ${styles.pillInk} ${styles.railsCard}`} title="Provider rails" subtitle="As the platform reports them">
      <ul className={styles.rails}>
        {keys.map((key) => (
          <li key={key}>
            {PROVIDER_LABELS[key]}
            <StatusPill status={rails[key]} />
          </li>
        ))}
      </ul>
      {keys.some((key) => rails[key] === "SIMULATED") && (
        <p className={styles.small}>Simulated means no live adapter: nothing is sent to the provider, so there is no uptime to show.</p>
      )}
    </BentoCard>
  );
};
