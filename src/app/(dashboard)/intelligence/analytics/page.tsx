"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Users, BarChart3 } from "lucide-react";
import styles from "../intelligence.module.css";

export default function CustomerSegmentsPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [custRes, cohRes] = await Promise.all([
        fetch("/api/v1/intelligence/customers"),
        fetch("/api/v1/intelligence/cohorts"),
      ]);
      const [custJson, cohJson] = await Promise.all([custRes.json(), cohRes.json()]);
      setCustomers(custJson.data?.customers || []);
      setCohorts(cohJson.data?.cohorts || []);
    } catch {
      // Ignore background errors
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Users size={24} color="var(--color-lime-ink)" /> Customer Segments
          </h1>
          <p className={styles.headerSubtitle}>
            Customer value and repeat-purchase cohorts, calculated from your orders. To ask a question about your shop, use <Link href="/assistant">Ask your shop</Link>.
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/analytics?tab=recommendations" className={styles.navTab}>← Analytics</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/analytics" className={`${styles.navTab} ${styles.navTabActive}`}>Customer Segments</Link>
      </div>

      {/* Row: Customer RFM Segmentation & Retention Cohorts */}
      <div className={styles.bentoGrid}>
        {/* Customer RFM Table */}
        <div className={`${styles.bentoCard} ${styles.col7}`}>
          <div className={styles.cardTitle}>
            <span><Users size={16} color="var(--color-lime-ink)" style={{ marginRight: 6 }} /> Customer value</span>
            <span className={styles.badgeNeutral}>{customers.length} Profiles</span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Segment</th>
                  <th>Observed LTV</th>
                  <th>Predicted LTV</th>
                  <th>Recency</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>No customer records found</td></tr>
                ) : (
                  customers.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className={styles.customerName}>{c.customer_name}</div>
                        <div className={styles.customerPhone}>{c.phone}</div>
                      </td>
                      <td>
                        <span className={
                          c.rfm_segment === "CHAMPIONS" || c.rfm_segment === "LOYAL_CUSTOMERS"
                            ? styles.badgeLime
                            : c.rfm_segment === "AT_RISK"
                            ? styles.badgeRed
                            : styles.badgeNeutral
                        }>
                          {c.rfm_segment}
                        </span>
                      </td>
                      <td>৳{c.observed_ltv_bdt?.toLocaleString()}</td>
                      <td>
                        <strong style={{ color: "var(--color-success-ink)" }}>৳{c.estimated_ltv_bdt?.toLocaleString()}</strong>
                      </td>
                      <td style={{ color: "var(--color-text-secondary)" }}>{c.recency_days}d ago</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Acquisition Cohorts */}
        <div className={`${styles.bentoCard} ${styles.col5}`}>
          <div className={styles.cardTitle}>
            <span><BarChart3 size={16} color="var(--color-lime-ink)" style={{ marginRight: 6 }} /> Customer Retention Cohorts</span>
            <span className={styles.badgeNeutral}>{cohorts.length} Cohorts</span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th>Size</th>
                  <th>Month 0</th>
                  <th>Month 1</th>
                  <th>Month 2</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>No cohort data recorded</td></tr>
                ) : (
                  cohorts.slice(0, 4).map((coh) => (
                    <tr key={coh.cohort_month}>
                      <td className={styles.cohortMonth}>{coh.cohort_month}</td>
                      <td style={{ color: "var(--color-text-secondary)" }}>{coh.cohort_size}</td>
                      <td>
                        {coh.periods?.[0]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[0].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                      <td>
                        {coh.periods?.[1]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[1].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                      <td>
                        {coh.periods?.[2]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[2].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
