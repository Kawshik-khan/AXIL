"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import type { ActivationFunnel } from "@/domains/platform/services/platform-analytics.service";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatCount, formatDhakaTime } from "../../_lib/format";
import type { ResourceState } from "../../_lib/use-platform-resource";
import { ResourceView } from "../ResourceView";
import { axisTicks, weekLabel } from "./control-tower-view";
import consoleStyles from "../../super-admin.module.css";
import styles from "./control-tower.module.css";

type Cohort = ActivationFunnel["weekly_cohorts"][number];

function SignupColumns({ cohorts }: { cohorts: readonly Cohort[] }) {
  const { top, ticks } = axisTicks(Math.max(...cohorts.map((c) => c.signups), 0));
  const height = (n: number) => `${(n / top) * 100}%`;
  return (
    <>
      <ul className={styles.legend} aria-hidden="true">
        <li>
          <i className={styles.keyWaiting} />
          No order yet
        </li>
        <li>
          <i className={styles.keyOrdered} />
          Has ordered
        </li>
      </ul>
      <div className={styles.plot}>
        {[0, ...ticks].map((t) => (
          <div key={t} className={styles.gridLine} style={{ bottom: height(t) }}>
            <span>{formatCount(t)}</span>
          </div>
        ))}
        <div className={styles.columns}>
          {cohorts.map((c) => {
            const text = `Week of ${weekLabel(c.week_start)}: ${formatCount(c.signups)} signed up, ${formatCount(c.with_order)} ordered`;
            const waiting = c.signups - c.with_order;
            return (
              <div key={c.week_start} className={styles.column} role="img" aria-label={text}>
                <span className={styles.tip} aria-hidden="true">
                  {text}
                </span>
                {waiting > 0 && <span className={`${styles.bar} ${styles.barWaiting}`} style={{ height: height(waiting) }} />}
                {c.with_order > 0 && (
                  <span className={`${styles.bar} ${styles.barOrdered} ${waiting > 0 ? styles.barBase : ""}`} style={{ height: height(c.with_order) }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.axis}>
        <span>{weekLabel(cohorts[0].week_start)}</span>
        <span>{weekLabel(cohorts[Math.floor(cohorts.length / 2)].week_start)}</span>
        <span>This week</span>
      </div>
    </>
  );
}

function SignupTable({ cohorts }: { cohorts: readonly Cohort[] }) {
  return (
    <div className={styles.tableScroll}>
      <table className={consoleStyles.table}>
        <thead>
          <tr>
            <th>Week of</th>
            <th className={consoleStyles.numeric}>Signups</th>
            <th className={consoleStyles.numeric}>Has ordered</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week_start}>
              <td>{weekLabel(c.week_start)}</td>
              <td className={consoleStyles.numeric}>{formatCount(c.signups)}</td>
              <td className={consoleStyles.numeric}>{formatCount(c.with_order)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const subtitleOf = (state: ResourceState<ActivationFunnel>, text: string) =>
  `${text}${state.kind === "ready" ? ` · as of ${formatDhakaTime(new Date(state.fetchedAt))}` : ""}`;

/** Weekly signups as stacked columns, with a table view. Same route as Insights; it loads once and on Refresh. */
export const SignupsCard: React.FC<{ state: ResourceState<ActivationFunnel>; onRetry: () => void }> = ({ state, onRetry }) => {
  const [asTable, setAsTable] = useState(false);
  const hasSignups = state.kind === "ready" && state.data.weekly_cohorts.some((c) => c.signups > 0);
  return (
    <BentoCard
      span={6}
      className={`${styles.card} ${styles.half}`}
      title="Signups per week"
      subtitle={subtitleOf(state, `Last ${state.kind === "ready" ? state.data.weekly_cohorts.length : 12} weeks`)}
      action={
        hasSignups ? (
          <button type="button" className={styles.softButton} onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show chart" : "Show table"}
          </button>
        ) : undefined
      }
    >
      <ResourceView
        state={state}
        onRetry={onRetry}
        resource="the activation funnel"
        emptyFigure="no-data"
        emptyTitle="No workspaces yet"
        emptyDescription="Signups appear here as workspaces are created."
        renderReady={(funnel) =>
          !hasSignups ? (
            <p className={styles.small}>No signups in this period.</p>
          ) : asTable ? (
            <SignupTable cohorts={funnel.weekly_cohorts} />
          ) : (
            <SignupColumns cohorts={funnel.weekly_cohorts} />
          )
        }
      />
    </BentoCard>
  );
};

/** How far workspaces got: signed up, added a product, received an order, paying. */
export const ActivationCard: React.FC<{ state: ResourceState<ActivationFunnel>; onRetry: () => void; canOpenInsights: boolean }> = ({
  state,
  onRetry,
  canOpenInsights,
}) => (
  <BentoCard
    span={4}
    className={`${styles.card} ${styles.activation}`}
    title="Activation"
    subtitle={subtitleOf(state, "Archived workspaces excluded")}
    action={
      canOpenInsights ? (
        <Link href={`${CONSOLE_ROOT}/insights`} className={styles.softButton}>
          Open Insights
        </Link>
      ) : undefined
    }
  >
    <ResourceView
      state={state}
      onRetry={onRetry}
      resource="the activation funnel"
      emptyFigure="no-data"
      emptyTitle="No workspaces yet"
      emptyDescription="The funnel fills as workspaces sign up, add products and take orders."
      renderReady={(funnel) => (
        <ul className={styles.funnel}>
          {[
            { label: "Signed up", n: funnel.workspaces },
            { label: "Added a product", n: funnel.with_product },
            { label: "Received an order", n: funnel.with_order },
            { label: "Paying", n: funnel.paying },
          ].map((s) => {
            const pct = Math.round((s.n / funnel.workspaces) * 100);
            return (
              <li key={s.label}>
                <div>
                  <b>{s.label}</b>
                  <span>
                    {formatCount(s.n)} · {pct}%
                  </span>
                </div>
                <div className={styles.funnelTrack} aria-hidden="true">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    />
  </BentoCard>
);
