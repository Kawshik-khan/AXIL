import React, { useState } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import type { FinancialMetrics } from "@/types/analytics";
import { compactMoney, formatCount, type Currency, type Section } from "./dashboard-data";
import { Panel, Trend } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

const DAY_MS = 86_400_000;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The smallest round number that holds the value and divides into four round gridlines. */
function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return ([1, 1.2, 1.6, 2, 3.2, 4, 6, 8].find((step) => step * power >= value) ?? 10) * power;
}

interface SalesChartProps {
  financials: Section<{ financials: FinancialMetrics }>;
  rangeDays: number;
  currency: Currency;
}

/** Gross sales over the period. The endpoint returns 7 to 14 equal slices of it, so a bar can cover several days. */
export const SalesChart: React.FC<SalesChartProps> = ({ financials, rangeDays, currency }) => {
  const f = financials.data?.financials ?? null;
  let note: React.ReactNode;
  if (f) {
    note =
      typeof f.period_change_pct === "number" ? (
        <Trend value={f.period_change_pct} suffix={`vs the previous ${rangeDays} days`} />
      ) : (
        `No sales in the previous ${rangeDays} days to compare`
      );
  }

  return (
    <Panel title="Gross sales" note={note} actions={f ? <span className={styles.headValue}>{currency.format(f.gmv_bdt)}</span> : undefined}>
      <SectionState section={financials} resource="sales figures" permission={PERMISSIONS.ANALYTICS_READ}>
        {({ financials: data }) => <Bars points={data.time_series} rangeDays={rangeDays} currency={currency} />}
      </SectionState>
    </Panel>
  );
};

interface BarsProps {
  points: FinancialMetrics["time_series"];
  rangeDays: number;
  currency: Currency;
}

const Bars: React.FC<BarsProps> = ({ points, rangeDays, currency }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const best = points.reduce((top, p, i) => (p.gmv_bdt > points[top].gmv_bdt ? i : top), 0);
  if (points.length === 0 || points[best].gmv_bdt === 0) return <p className={styles.empty}>No sales in the last {rangeDays} days.</p>;

  const max = niceMax(points[best].gmv_bdt);
  // Slices are counted back from now, not from midnight, so one can start and end mid-day: name both of its dates
  const startOf = (i: number) => (i < points.length ? Date.parse(points[i].date) : Date.parse(points[0].date) + rangeDays * DAY_MS);
  const label = (i: number) => `${shortDate(startOf(i))} to ${shortDate(startOf(i + 1))}`;
  const sliceDays = rangeDays / points.length;
  const sliceText = sliceDays === 1 ? "24 hours" : `about ${Math.round(sliceDays)} days`;
  const labelEvery = points.length > 7 ? 3 : 1;
  const third = points.length / 3;

  return (
    <div className={styles.chart}>
      <div className={styles.chartAxis} aria-hidden="true">
        {TICKS.map((t) => (
          <span key={t} style={{ bottom: `${t * 100}%` }}>
            {t === 0 ? "0" : compactMoney(currency, max * t)}
          </span>
        ))}
      </div>
      <div className={styles.chartPlot} aria-hidden="true">
        {TICKS.map((t) => (
          <span key={t} className={styles.gridLine} style={{ bottom: `${t * 100}%` }} />
        ))}
        <div className={styles.bars}>
          {points.map((p, i) => {
            const height = `${(p.gmv_bdt / max) * 100}%`;
            const side = i < third ? styles.tipLeft : i >= third * 2 ? styles.tipRight : styles.tipCentre;
            return (
              <div key={i} className={styles.barSlot} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                <div className={`${styles.bar} ${i === best ? styles.barBest : ""}`} style={{ height }} />
                {i % labelEvery === 0 && <span className={styles.barLabel}>{shortDate(startOf(i))}</span>}
                {hovered === i && (
                  <span className={`${styles.tip} ${side}`} style={{ bottom: `calc(${height} + 8px)` }}>
                    <strong>{currency.format(p.gmv_bdt)}</strong>
                    {label(i)}, {formatCount(p.orders_count)} {p.orders_count === 1 ? "order" : "orders"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className={`${styles.note} ${styles.chartBest}`}>
        <span className={styles.swatch} style={{ background: "var(--chart-best)" }} />
        Highest: {label(best)}, {currency.format(points[best].gmv_bdt)}. Each bar is {sliceText}.
      </p>
      <table className={styles.srOnly}>
        <caption>Gross sales, last {rangeDays} days</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{label(i)}</th>
              <td>{currency.format(p.gmv_bdt)}</td>
              <td>{p.orders_count} orders</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
