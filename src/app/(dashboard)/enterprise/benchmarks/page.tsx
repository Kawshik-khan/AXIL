"use client";

import React, { useEffect, useState } from "react";
import {
  Scale,
  Award,
  TrendingUp,
  RefreshCw,
  Zap,
  ArrowUpRight,
  Info,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { EnterpriseBenchmark } from "@/types/enterprise";

export default function EnterpriseBenchmarksPage() {
  const [benchmark, setBenchmark] = useState<EnterpriseBenchmark | null>(null);
  const [metricKey, setMetricKey] = useState<string>("gross_revenue");
  const [benchmarkType, setBenchmarkType] = useState<string>("STORE");
  const [loading, setLoading] = useState(true);

  const fetchBenchmark = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/enterprise/benchmarks?metric_key=${metricKey}&type=${benchmarkType}`);
      const json = await res.json();
      setBenchmark(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBenchmark();
  }, [metricKey, benchmarkType]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Scale size={28} color="#c7f900" />
            Cross-Store & Brand Benchmarking
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Percentile distributions, efficiency frontiers, and performance variance driver analysis
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchBenchmark}>
            <RefreshCw size={14} />
            <span>Recalculate</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {/* Benchmark Control Bar */}
      <div className={styles.card} style={{ marginBottom: 24, padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 4 }}>
              Benchmark Scope
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={benchmarkType === "STORE" ? styles.btnPrimary : styles.btnSecondary}
                onClick={() => setBenchmarkType("STORE")}
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                Cross-Store
              </button>
              <button
                className={benchmarkType === "BRAND" ? styles.btnPrimary : styles.btnSecondary}
                onClick={() => setBenchmarkType("BRAND")}
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                Cross-Brand
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 4 }}>
              Evaluation Metric
            </label>
            <select
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
              style={{
                padding: "8px 12px",
                background: "#121316",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "#ffffff",
                fontSize: 13,
              }}
            >
              <option value="gross_revenue">Gross Revenue (BDT)</option>
              <option value="average_order_value">Average Order Value (AOV)</option>
              <option value="delivery_sla_pct">Delivery SLA Compliance (%)</option>
              <option value="gross_margin_pct">Gross Margin (%)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Percentile Stats Bento Grid */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Cohort Average</div>
          <div className={styles.statValue}>
            {benchmark?.cohort_average ? benchmark.cohort_average.toLocaleString() : "—"}
          </div>
          <div className={styles.statMeta}>Cross-entity cohort mean baseline</div>
        </div>

        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Median Benchmark (P50)</div>
          <div className={styles.statValue} style={{ color: "#c7f900" }}>
            {benchmark?.cohort_median ? benchmark.cohort_median.toLocaleString() : "—"}
          </div>
          <div className={styles.statMeta}>Network central median performance</div>
        </div>

        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Cohort Entities Evaluated</div>
          <div className={styles.statValue}>
            {benchmark?.population_count ? `${benchmark.population_count} entities` : "—"}
          </div>
          <div className={styles.statMeta}>
            {benchmark?.is_statistically_significant ? "Statistically valid sample" : "Small cohort sample"}
          </div>
        </div>
      </div>

      {/* Ranked Entity Leaderboard */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Award size={18} color="#c7f900" />
              Ranked Entity Performance & Drivers
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Entity</th>
                  <th>Value</th>
                  <th>Percentile</th>
                  <th>Performance Tier</th>
                  <th>Variance vs Average</th>
                </tr>
              </thead>
              <tbody>
                {benchmark?.items && benchmark.items.length > 0 ? (
                  benchmark.items.map((item) => (
                    <tr key={item.entity_id}>
                      <td style={{ fontWeight: 800, color: item.rank === 1 ? "#c7f900" : "#ffffff" }}>
                        #{item.rank}
                      </td>
                      <td style={{ fontWeight: 600, color: "#ffffff" }}>{item.entity_name}</td>
                      <td>{item.value.toLocaleString()}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: "#c7f900" }}>{item.percentile}th</span>
                      </td>
                      <td>
                        <span
                          className={
                            item.percentile >= 70
                              ? styles.badgeHealthy
                              : item.percentile >= 30
                              ? styles.badgeDegraded
                              : styles.badgeCritical
                          }
                        >
                          {item.percentile >= 70
                            ? "Top Quartile"
                            : item.percentile >= 30
                            ? "Median Tier"
                            : "Uplift Required"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: item.variance_from_average_pct >= 0 ? "#c7f900" : "#f87171" }}>
                        {item.variance_from_average_pct > 0 ? "+" : ""}
                        {item.variance_from_average_pct}% vs average
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>
                      No benchmark data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
