import React from "react";
import Link from "next/link";
import { PERMISSIONS } from "@/lib/permissions";
import { formatCount, type DashboardMetrics, type Section } from "./dashboard-data";
import { Ring } from "./Ring";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

/** The lilac panel: the work waiting in orders, payments and stock, from real counts, each linking to where it's done. */
export const AttentionPanel: React.FC<{ metrics: Section<{ metrics: DashboardMetrics }> }> = ({ metrics }) => (
  <section className={`${styles.card} ${styles.panel} ${styles.attention}`} aria-label="Needs attention">
    <div>
      <h2 className={styles.panelTitle}>Needs attention</h2>
      <p className={styles.attentionNote}>From orders, payments and stock</p>
    </div>
    <SectionState section={metrics} resource="the work queue" permission={PERMISSIONS.DASHBOARD_READ}>
      {({ metrics: m }) => {
        const queue = [
          { id: "orders", label: "Orders to process", note: "Pending, confirmed or processing", count: m.pendingOrdersCount, color: "var(--chart-queue-1)", href: "/orders" },
          { id: "payments", label: "Unpaid orders", note: "Payment pending or not received", count: m.pendingPaymentsCount, color: "var(--chart-queue-2)", href: "/orders" },
          { id: "stock", label: "Stock to reorder", note: "Low items, counted per warehouse", count: m.lowStockCount, color: "var(--chart-queue-3)", href: "/inventory" },
        ];
        // One order can need both processing and payment: the total adds the three lists up, so it is called items,
        // never orders
        const total = queue.reduce((sum, q) => sum + q.count, 0);
        const first = queue.find((q) => q.count > 0);
        return (
          <div className={styles.attentionBody}>
            <div className={`${styles.ringBox} ${styles.ringLarge}`}>
              <Ring
                size={200}
                thickness={20}
                label={total === 0 ? "Nothing listed" : queue.map((q) => `${q.label} ${q.count}`).join(", ")}
                segments={queue.map((q) => ({ id: q.id, value: q.count, color: q.color }))}
              />
              <div className={styles.ringCentre}>
                <strong>{formatCount(total)}</strong>
                <span>{total === 1 ? "item listed" : "items listed"}</span>
              </div>
            </div>
            <div className={styles.queue}>
              {queue.map((q) => (
                <Link key={q.id} href={q.href} className={styles.queueRow}>
                  <span className={styles.swatch} style={{ background: q.color }} />
                  <span className={styles.queueText}>
                    <strong>{q.label}</strong>
                    <span>{q.note}</span>
                  </span>
                  <span className={styles.queueCount}>{formatCount(q.count)}</span>
                </Link>
              ))}
              {first ? (
                <Link href={first.href} className={styles.primary}>
                  {first.id === "stock" ? "Open inventory" : "Open orders"}
                </Link>
              ) : (
                <p className={styles.attentionNote}>Nothing is listed right now.</p>
              )}
            </div>
          </div>
        );
      }}
    </SectionState>
  </section>
);
