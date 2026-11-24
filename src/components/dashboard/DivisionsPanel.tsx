import React, { useState } from "react";
import { BrandIcon, brandFor } from "@/components/brand/BrandIcon";
import { PERMISSIONS } from "@/lib/permissions";
import { formatCount, paymentName, type Currency, type DashboardMetrics, type Section } from "./dashboard-data";
import { Panel, Segmented } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

type View = "orders" | "repeat";

interface DivisionsPanelProps {
  metrics: Section<{ metrics: DashboardMetrics }>;
  currency: Currency;
}

/** Orders and repeat buyers by shipping division, with how customers pay below. */
export const DivisionsPanel: React.FC<DivisionsPanelProps> = ({ metrics, currency }) => {
  const [view, setView] = useState<View>("orders");

  return (
    <Panel
      title="Divisions"
      actions={
        <Segmented<View>
          small
          label="Division measure"
          value={view}
          onChange={setView}
          options={[
            { value: "orders", label: "Orders" },
            { value: "repeat", label: "Buy again" },
          ]}
        />
      }
    >
      <SectionState section={metrics} resource="orders by division" permission={PERMISSIONS.DASHBOARD_READ}>
        {({ metrics: m }) => {
          if (m.cityAnalysisData.length === 0) return <p className={styles.empty}>No orders yet.</p>;
          return (
            <>
              <div className={styles.divisions}>
                {m.cityAnalysisData.map((d) => {
                  const percent = view === "orders" ? d.volumePercent : d.returningBuyerPercent;
                  const orders = `${formatCount(d.orders)} orders, ${d.volumePercent}%`;
                  const repeat = percent === null ? "No buyers yet" : `${percent}% buy again`;
                  return (
                    <div key={d.id} title={`${currency.format(d.revenueBDT)} paid, ${d.reorderFreq ?? "—"} orders per buyer`}>
                      <div className={styles.divisionHead}>
                        <span>{d.city}</span>
                        <span>{view === "orders" ? orders : repeat}</span>
                      </div>
                      <div className={styles.track}>
                        <div className={styles.trackFill} style={{ width: `${percent ?? 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {m.paymentMix.length > 0 && (
                <div className={styles.paidBy}>
                  <span className={styles.note}>Payment method</span>
                  {m.paymentMix.map((p) => {
                    const brand = brandFor(p.method);
                    return (
                      <span key={p.method} className={styles.chip}>
                        {brand && <BrandIcon brand={brand} size={12} />}
                        {paymentName(p.method)} {p.percent}%
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          );
        }}
      </SectionState>
    </Panel>
  );
};
