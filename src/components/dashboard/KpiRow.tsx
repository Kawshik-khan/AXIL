import React from "react";
import Link from "next/link";
import { PERMISSIONS } from "@/lib/permissions";
import type { FinancialMetrics } from "@/types/analytics";
import { formatCount, type Currency, type DashboardMetrics, type Section } from "./dashboard-data";
import { Trend } from "./Panel";
import { RevenueSparkline } from "./RevenueSparkline";
import styles from "./Dashboard.module.css";

interface KpiRowProps {
  metrics: Section<{ metrics: DashboardMetrics }>;
  financials: Section<{ financials: FinancialMetrics }>;
  rangeDays: number;
  currency: Currency;
}

/** Why a figure is missing, so "—" is never mistaken for zero. */
function missingNote(section: { loading: boolean; status: number }, permission: string): string {
  if (section.loading) return "Loading";
  return section.status === 403 ? `Needs ${permission}` : "Could not load";
}

const Tile: React.FC<{ href: string; label: string; value: string; note: React.ReactNode }> = ({ href, label, value, note }) => (
  <Link href={href} className={`${styles.card} ${styles.kpi}`}>
    <span className={styles.kpiLabel}>{label}</span>
    <span>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.note}>{note}</span>
    </span>
  </Link>
);

export const KpiRow: React.FC<KpiRowProps> = ({ metrics, financials, rangeDays, currency }) => {
  const m = metrics.data?.metrics ?? null;
  const f = financials.data?.financials ?? null;
  const noMetrics = missingNote(metrics, PERMISSIONS.DASHBOARD_READ);
  const noFinancials = missingNote(financials, PERMISSIONS.ANALYTICS_READ);
  const ordersChange = m?.periodComparison.orders_change_pct;

  let marginNote = noFinancials;
  if (f) {
    if (f.gross_margin_pct === null) marginNote = "No sales in period";
    else marginNote = f.cogs_estimated_share_pct > 0 ? `${f.cogs_estimated_share_pct}% cost est.` : "From cost prices";
  }
  let revenueNote = noFinancials;
  if (f) {
    if (f.total_refunds_bdt > 0) revenueNote = `Includes unpaid, ${currency.format(f.total_refunds_bdt)} refunded`;
    else revenueNote = f.gmv_bdt > 0 ? "Includes unpaid orders" : "No sales in this period";
  }
  const trend = (f?.time_series ?? []).map((p) => p.gmv_bdt);

  return (
    <section className={styles.kpiRow} aria-label="Key figures">
      <Link href="/analytics" className={`${styles.card} ${styles.kpi} ${styles.kpiLead}`} aria-busy={financials.loading}>
        <span className={styles.kpiLabel}>Net revenue, {rangeDays} days</span>
        <span className={styles.kpiLeadBody}>
          <span>
            <span className={styles.kpiLeadValue}>{f ? currency.format(f.nmv_bdt) : "—"}</span>
            <span className={styles.kpiLeadNote}>{revenueNote}</span>
          </span>
          {f && f.gmv_bdt > 0 && (
            <span className={styles.spark}>
              <RevenueSparkline values={trend} label={`Gross sales over the last ${rangeDays} days`} />
            </span>
          )}
        </span>
      </Link>

      <Tile
        href="/orders"
        label="Orders, 30 days"
        value={m ? formatCount(m.periodComparison.orders_last_30d) : "—"}
        note={!m ? noMetrics : typeof ordersChange === "number" ? <Trend value={ordersChange} suffix="vs prior" /> : "No prior period"}
      />
      <Tile
        href="/customers"
        label="Active customers"
        value={m ? formatCount(m.activeCustomers) : "—"}
        note={!m ? noMetrics : m.returningBuyerPercent === null ? "No buyers yet" : `${m.returningBuyerPercent}% buy again`}
      />
      <Tile
        href="/analytics"
        label="Average order"
        value={m && m.averageOrderValue > 0 ? currency.format(m.averageOrderValue) : "—"}
        note={m ? "Paid, all time" : noMetrics}
      />
      <Tile
        href="/analytics"
        label={`Margin, ${rangeDays} days`}
        value={typeof f?.gross_margin_pct === "number" ? `${f.gross_margin_pct}%` : "—"}
        note={marginNote}
      />
    </section>
  );
};
