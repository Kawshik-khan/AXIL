import React from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import { LoadingSkeleton } from "@/components/ui/States/States";
import styles from "./control-tower.module.css";

/** First load: the board's own geometry, so nothing jumps when the figures arrive. */
export const ControlTowerSkeleton: React.FC = () => (
  <div className={styles.board} role="status" aria-label="Loading the Control Tower">
    <div className={styles.lead}>
      {[0, 1, 2, 3].map((i) => (
        <BentoCard key={i} span={3} className={styles.tile}>
          <LoadingSkeleton lines={1} inline />
        </BentoCard>
      ))}
      <BentoCard span={6} className={`${styles.card} ${styles.half}`}>
        <LoadingSkeleton lines={5} inline />
      </BentoCard>
      <BentoCard span={6} className={`${styles.card} ${styles.half}`}>
        <LoadingSkeleton lines={5} inline />
      </BentoCard>
    </div>
    <BentoCard span={3} className={styles.workspaces}>
      <LoadingSkeleton lines={6} inline />
    </BentoCard>
    <BentoCard span={9} className={`${styles.card} ${styles.deskState}`}>
      <LoadingSkeleton lines={8} inline />
    </BentoCard>
  </div>
);
