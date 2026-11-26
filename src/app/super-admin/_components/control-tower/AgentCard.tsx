import React from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import type { AgentHealth } from "@/domains/platform/services/agent-health.service";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatCount, formatDhakaTime, formatPercent } from "../../_lib/format";
import type { ResourceState } from "../../_lib/use-platform-resource";
import { ResourceView } from "../ResourceView";
import { formatLatency } from "./control-tower-view";
import styles from "./control-tower.module.css";

function TurnColumns({ hours }: { hours: AgentHealth["turns_per_hour"] }) {
  const max = Math.max(...hours.map((h) => h.turns), 1);
  return (
    <>
      <div className={`${styles.plot} ${styles.plotShort}`}>
        <div className={styles.columns}>
          {hours.map((h) => {
            const text = `${formatDhakaTime(new Date(h.hour))} · ${formatCount(h.turns)} turns`;
            return (
              <div key={h.hour} className={styles.column} role="img" aria-label={text}>
                <span className={styles.tip} aria-hidden="true">
                  {text}
                </span>
                {h.turns > 0 && <span className={`${styles.bar} ${styles.barThin} ${styles.barWaiting}`} style={{ height: `${(h.turns / max) * 100}%` }} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className={`${styles.axis} ${styles.axisFlush}`}>
        <span>24 hours ago</span>
        <span>12 hours ago</span>
        <span>Now</span>
      </div>
    </>
  );
}

/** Customer-agent health across every workspace, from the same route as AI Governance. */
export const AgentCard: React.FC<{ state: ResourceState<AgentHealth>; onRetry: () => void }> = ({ state, onRetry }) => (
  <BentoCard
    span={5}
    className={`${styles.card} ${styles.agent}`}
    title="Customer agent"
    subtitle="Every workspace, last 24 hours"
    action={
      <Link href={`${CONSOLE_ROOT}/ai`} className={styles.softButton}>
        Open AI Governance
      </Link>
    }
  >
    <ResourceView
      state={state}
      onRetry={onRetry}
      resource="agent health"
      emptyFigure="no-data"
      emptyTitle="No agent turns in 24 hours"
      emptyDescription="Turns, latency and cost appear once the customer agent answers a message."
      renderReady={(h) => (
        <>
          <div className={styles.agentTotal}>
            <b>{formatCount(h.turns)}</b>
            <span className={styles.small}>turns</span>
          </div>
          <TurnColumns hours={h.turns_per_hour} />
          <dl className={styles.facts}>
            {[
              ["Typical reply (p50)", formatLatency(h.latency_p50_ms)],
              ["Slowest 5% (p95)", formatLatency(h.latency_p95_ms)],
              ["Estimated cost", `USD ${h.cost_usd_last_24h.toFixed(2)}`],
              ["Handed to a person", formatPercent(h.handoff_rate)],
              ["Tool failures", formatPercent(h.tool_failure_rate)],
              ["Throttled calls", formatPercent(h.throttled_rate)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    />
  </BentoCard>
);
