"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, PieChart, DollarSign, TrendingUp, Layers } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton } from "@/components/ui/States/States";

export default function AttributionPage() {
  const [attribution, setAttribution] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/growth/attribution")
      .then((r) => r.json())
      .then((j) => setAttribution(j.data.attribution))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <BarChart3 size={26} color="var(--color-lime-primary, #C7F900)" /> Multi-Touch Campaign Attribution
          </h1>
          <p className={styles.headerSubtitle}>
            Compare multi-touch attribution models and evaluate incremental revenue
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={styles.navTab}>Audiences</Link>
        <Link href="/growth/campaigns" className={styles.navTab}>Campaigns</Link>
        <Link href="/growth/journeys" className={styles.navTab}>Journeys</Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>Lifecycle</Link>
        <Link href="/growth/attribution" className={`${styles.navTab} ${styles.navTabActive}`}>Attribution</Link>
        <Link href="/growth/experiments" className={styles.navTab}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={5} />
      ) : (
        <>
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>
                <span>Total Attributed Revenue</span>
                <DollarSign size={16} color="var(--color-lime-primary, #C7F900)" />
              </div>
              <div className={styles.metricValue}>
                ৳{(attribution?.total_attributed_revenue_bdt || 0).toLocaleString()}
              </div>
              <div className={styles.metricSubtext}>Across all multi-channel campaigns</div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>
                <span>Total Incremental Revenue</span>
                <TrendingUp size={16} color="#3b82f6" />
              </div>
              <div className={styles.metricValue}>
                ৳{(attribution?.total_incremental_revenue_bdt || 0).toLocaleString()}
              </div>
              <div className={styles.metricSubtext}>Lift above baseline organic conversion</div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>
                <span>Blended ROAS</span>
                <Layers size={16} color="#f59e0b" />
              </div>
              <div className={styles.metricValue}>
                {attribution?.blended_roas || "0.0"}x
              </div>
              <div className={styles.metricSubtext}>Return on total marketing spend</div>
            </div>
          </div>

          {/* Model Comparison Table */}
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardTitle}>Attribution Model Comparison</div>
            <div className={styles.cardSubtitle}>
              Multi-touch attribution models: First-Touch, Last-Touch, Linear, Time-Decay
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Attribution Model</th>
                    <th>Lookback Window</th>
                    <th>Weighting Formula</th>
                    <th>Best Used For</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className={`${styles.statusPill} ${styles.statusRunning}`}>LAST_TOUCH</span></td>
                    <td>14 Days</td>
                    <td>100% weight to final campaign touchpoint before purchase</td>
                    <td>Direct conversion channel evaluation</td>
                  </tr>
                  <tr>
                    <td><span className={`${styles.statusPill} ${styles.statusScheduled}`}>FIRST_TOUCH</span></td>
                    <td>30 Days</td>
                    <td>100% weight to original acquiring campaign touchpoint</td>
                    <td>Customer acquisition analysis</td>
                  </tr>
                  <tr>
                    <td><span className={`${styles.statusPill} ${styles.statusReview}`}>LINEAR</span></td>
                    <td>14 Days</td>
                    <td>Equal weight split evenly across all journey interactions</td>
                    <td>Full-funnel collaborative touchpoint credit</td>
                  </tr>
                  <tr>
                    <td><span className={`${styles.statusPill} ${styles.statusDraft}`}>TIME_DECAY</span></td>
                    <td>14 Days</td>
                    <td>Exponential decay favoring interactions closest in time to checkout</td>
                    <td>Nurturing & repeat repurchase velocity</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
