"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  RefreshCw,
  Calculator,
  Layers,
  Code,
  CheckCircle2,
  PieChart,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { ConsolidatedEnterpriseAnalytics, MetricDefinition, SemanticMetricResult } from "@/types/enterprise";

export default function EnterpriseAnalyticsPage() {
  const [analytics, setAnalytics] = useState<ConsolidatedEnterpriseAnalytics | null>(null);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string>("gross_revenue");
  const [metricResult, setMetricResult] = useState<SemanticMetricResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const [anaRes, metRes] = await Promise.all([
        fetch("/api/v1/enterprise/analytics"),
        fetch("/api/v1/enterprise/metrics"),
      ]);

      const [anaData, metData] = await Promise.all([anaRes.json(), metRes.json()]);
      setAnalytics(anaData.data);
      setMetrics(metData.data?.metrics || []);

      // Query default metric
      const queryRes = await fetch(`/api/v1/enterprise/metrics?metric_key=${selectedMetric}`);
      const queryJson = await queryRes.json();
      setMetricResult(queryJson.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleMetricChange = async (key: string) => {
    setSelectedMetric(key);
    try {
      const res = await fetch(`/api/v1/enterprise/metrics?metric_key=${key}`);
      const json = await res.json();
      setMetricResult(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <BarChart3 size={28} color="#c7f900" />
            Enterprise Analytics & Governed Semantic KPIs
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Cross-entity multidimensional slicing, standard metric formulas, and store breakdown
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchAnalytics}>
            <RefreshCw size={14} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {/* Semantic Metric Explorer Bento */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Calculator size={18} color="#c7f900" />
              Semantic Metric Evaluator
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
              Select Governed Metric Definition
            </label>
            <select
              value={selectedMetric}
              onChange={(e) => handleMetricChange(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#121316",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "#ffffff",
                fontSize: 13,
              }}
            >
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} ({m.key})
                </option>
              ))}
            </select>
          </div>

          {metricResult && (
            <div
              style={{
                padding: 16,
                background: "rgba(199, 249, 0, 0.05)",
                border: "1px solid rgba(199, 249, 0, 0.2)",
                borderRadius: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#9ca3af" }}>Evaluated Result</span>
                <span style={{ fontSize: 11, color: "#c7f900", fontWeight: 700 }}>SAMPLE: {metricResult.sample_count}</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#ffffff", marginBottom: 4 }}>
                {metricResult.unit === "BDT" ? "৳" : ""}
                {metricResult.value.toLocaleString()}
                {metricResult.unit === "%" ? "%" : ""}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                Formula: <code style={{ color: "#c7f900" }}>{metricResult.formula_used}</code>
              </div>
            </div>
          )}
        </div>

        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Code size={18} color="#c7f900" />
              Governed Metric Definitions ({metrics.length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 250, overflowY: "auto" }}>
            {metrics.map((m) => (
              <div
                key={m.id}
                style={{
                  padding: 10,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: "#ffffff" }}>{m.name}</span>
                  <span style={{ color: "#c7f900", fontFamily: "monospace" }}>{m.category}</span>
                </div>
                <div style={{ color: "#9ca3af", fontFamily: "monospace", fontSize: 11 }}>{m.formula}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Store Breakdown Bento Table */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Layers size={18} color="#c7f900" />
              Store-Level Performance Breakdown
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Revenue (BDT)</th>
                  <th>Orders</th>
                  <th>AOV</th>
                  <th>Active Catalog</th>
                  <th>Fulfillment SLA</th>
                  <th>Share of Network</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.entities && analytics.entities.length > 0 ? (
                  analytics.entities.map((ent) => {
                    const sharePct =
                      analytics.total_revenue_bdt > 0
                        ? Math.round((ent.revenue_bdt / analytics.total_revenue_bdt) * 100)
                        : 0;
                    return (
                      <tr key={ent.entity_id}>
                        <td style={{ fontWeight: 600, color: "#ffffff" }}>{ent.entity_name}</td>
                        <td>৳{ent.revenue_bdt.toLocaleString()}</td>
                        <td>{ent.orders_count}</td>
                        <td>৳{ent.aov_bdt.toLocaleString()}</td>
                        <td>{ent.active_skus_count} SKUs</td>
                        <td>{ent.delivery_sla_pct}%</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                              style={{
                                width: 80,
                                height: 6,
                                background: "rgba(255,255,255,0.1)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${sharePct}%`,
                                  height: "100%",
                                  background: "#c7f900",
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>{sharePct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>
                      No store analytics data available.
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
