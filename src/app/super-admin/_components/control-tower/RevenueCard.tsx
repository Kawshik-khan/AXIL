import React from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatCount, formatMoney } from "../../_lib/format";
import { mrrByPlan, type SubscriptionRow } from "./control-tower-view";
import { Donut } from "./Donut";
import styles from "./control-tower.module.css";

/** Monthly recurring revenue by plan (from subscriptions), with ARR and ARPU from the overview. */
export const RevenueCard: React.FC<{
  financials: PlatformOverviewMetrics["financials"];
  /** null without subscription.read or while unknown: the split is left out, the totals stay. */
  subscriptions: readonly SubscriptionRow[] | null;
  canOpenBilling: boolean;
}> = ({ financials: f, subscriptions, canOpenBilling }) => {
  const plans = subscriptions ? mrrByPlan(subscriptions) : [];
  const paying = f.active_subscriptions_count > 0;
  return (
    <BentoCard
      span={6}
      className={`${styles.card} ${styles.half}`}
      title="Revenue by plan"
      subtitle="Monthly, active subscriptions"
      action={
        canOpenBilling ? (
          <Link href={`${CONSOLE_ROOT}/billing?tab=subscriptions`} className={styles.softButton}>
            Open Billing
          </Link>
        ) : undefined
      }
    >
      <div className={plans.length > 0 ? styles.split : undefined}>
        {plans.length > 0 && (
          <Donut
            parts={plans}
            className={styles.revenueDonut}
            label={`Revenue by plan: ${plans.map((p) => `${p.label} BDT ${formatCount(p.value)}`).join(", ")}`}
          >
            <strong>{formatCount(f.active_subscriptions_count)}</strong>
            <span>paying</span>
          </Donut>
        )}
        <ul className={styles.rows}>
          {plans.map((p) => (
            <li key={p.key}>
              <i style={{ background: p.color }} />
              <span>{p.label}</span>
              <b>{formatMoney(p.value, f.currency)}</b>
            </li>
          ))}
          <li>
            <span>MRR</span>
            <b>{paying ? formatMoney(f.mrr_bdt, f.currency) : "No active subscriptions"}</b>
          </li>
          {paying && (
            <>
              <li>
                <span>ARR</span>
                <b>{formatMoney(f.arr_bdt, f.currency)}</b>
              </li>
              <li>
                <span>ARPU</span>
                <b>{formatMoney(f.arpu_bdt, f.currency)}</b>
              </li>
            </>
          )}
        </ul>
      </div>
    </BentoCard>
  );
};
