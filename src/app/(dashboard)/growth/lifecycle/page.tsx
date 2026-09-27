"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Users, History, Activity, TrendingUp } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton } from "@/components/ui/States/States";

export default function LifecyclePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/growth/lifecycle")
      .then((r) => r.json())
      .then((j) => setData(j.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const distribution = data?.distribution || {};
  const transitions = data?.transitions || [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Users size={26} color="var(--color-lime-primary, #C7F900)" /> Customer Lifecycle Matrix
          </h1>
          <p className={styles.headerSubtitle}>
            Deterministic 10-stage lifecycle states and real-time transition logs
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={styles.navTab}>Audiences</Link>
        <Link href="/growth/campaigns" className={styles.navTab}>Campaigns</Link>
        <Link href="/growth/journeys" className={styles.navTab}>Journeys</Link>
        <Link href="/growth/lifecycle" className={`${styles.navTab} ${styles.navTabActive}`}>Lifecycle</Link>
        <Link href="/growth/attribution" className={styles.navTab}>Attribution</Link>
        <Link href="/growth/experiments" className={styles.navTab}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={5} />
      ) : (
        <div className={styles.bentoGrid}>
          {/* Lifecycle Stages Grid */}
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardTitle}>10-Stage Lifecycle State Matrix</div>
            <div className={styles.cardSubtitle}>Real-time breakdown of all customer accounts across lifecycle states</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px", marginTop: "12px" }}>
              {Object.entries(distribution).map(([stage, count]) => (
                <div key={stage} style={{ background: "var(--color-surface-soft, #FAFBF8)", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))", padding: "16px", borderRadius: "12px" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{stage}</div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #202124)", marginTop: "6px" }}>
                    {String(count)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Transitions Stream */}
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardTitle}>
              <Activity size={18} color="var(--color-lime-primary, #C7F900)" /> Recent Lifecycle Transition Events
            </div>
            <div className={styles.cardSubtitle}>Audit trail of automated and purchase-driven state shifts</div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Customer ID</th>
                    <th>From Stage</th>
                    <th>To Stage</th>
                    <th>Trigger Event</th>
                    <th>Reason</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {transitions.map((t: any) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.customer_id}</td>
                      <td><span className={styles.statusPill}>{t.from_stage}</span></td>
                      <td><span className={`${styles.statusPill} ${styles.statusRunning}`}>{t.to_stage}</span></td>
                      <td>{t.trigger_event}</td>
                      <td style={{ color: "var(--color-text-secondary, #70736F)" }}>{t.reason}</td>
                      <td style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)" }}>{new Date(t.transitioned_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {transitions.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-secondary, #70736F)", padding: "28px" }}>
                        No lifecycle transitions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
