import React from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { channelColor, formatCount, type Currency, type DashboardMetrics, type Section } from "./dashboard-data";
import { Panel } from "./Panel";
import { Ring } from "./Ring";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

interface ChannelMixProps {
  metrics: Section<{ metrics: DashboardMetrics }>;
  currency: Currency;
  selected: string | null;
  onSelect: (channel: string | null) => void;
}

/** All recorded orders by sales channel. Choosing a channel also filters the recent orders. */
export const ChannelMix: React.FC<ChannelMixProps> = ({ metrics, currency, selected, onSelect }) => (
  <Panel title="Sales channels" note="All orders, by where they came from" link={{ href: "/conversations", label: "Inbox" }}>
    <SectionState section={metrics} resource="sales channels" permission={PERMISSIONS.DASHBOARD_READ}>
      {({ metrics: m }) => {
        if (m.totalOrders === 0) return <p className={styles.empty}>No orders yet.</p>;
        const channels = m.channelData;
        const active = channels.find((c) => c.shortName === selected);
        return (
          <div className={styles.mix}>
            <div className={styles.ringBox}>
              <Ring
                size={156}
                thickness={24}
                label={channels.map((c) => `${c.shortName} ${c.sharePercent}%`).join(", ")}
                segments={channels.map((c) => ({
                  id: c.id,
                  value: c.orders,
                  color: channelColor(c.id),
                  dimmed: active !== undefined && active.id !== c.id,
                }))}
              />
              <div className={styles.ringCentre}>
                <strong>{formatCount(active ? active.orders : m.totalOrders)}</strong>
                <span>orders</span>
              </div>
            </div>
            <div className={styles.mixList}>
              {channels.map((c) => {
                const on = c.shortName === selected;
                return (
                  <button key={c.id} type="button" className={styles.mixRow} aria-pressed={on} onClick={() => onSelect(on ? null : c.shortName)}>
                    <span className={styles.swatch} style={{ background: channelColor(c.id) }} />
                    <span className={styles.mixName}>{c.shortName}</span>
                    <strong>{formatCount(c.orders)}</strong>
                    <span className={styles.mixShare}>{c.sharePercent}%</span>
                  </button>
                );
              })}
            </div>
            {active && (
              <p className={styles.note}>
                {active.shortName}: {currency.format(active.revenueBDT)} paid
                {active.agentStatus !== "—" ? `, ${active.agentStatus.toLowerCase()}` : ""}
              </p>
            )}
          </div>
        );
      }}
    </SectionState>
  </Panel>
);
