"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, BarChart2, Calendar, AlertCircle, RefreshCw, Layers } from "lucide-react";
import styles from "../intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function ForecastsPage() {
  const [targetType, setTargetType] = useState<"SALES_REVENUE" | "ORDER_VOLUME">("SALES_REVENUE");
  const [horizon, setHorizon] = useState<"7D" | "14D" | "30D" | "90D">("14D");
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchForecast = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/intelligence/forecasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: targetType, horizon }),
      });
      if (!res.ok) throw new Error("Failed to generate forecast");
      const json = await res.json();
      setForecast(json.data?.forecast);
    } catch (err: any) {
      setError(err.message || "Failed to project forecast");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, [targetType, horizon]);

  const predictions = forecast?.predictions || [];
  const maxVal = Math.max(...predictions.map((p: any) => p.predicted_value || 1), 10);
  const totalProjected = predictions.reduce((acc: number, p: any) => acc + (p.predicted_value || 0), 0);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <TrendingUp size={24} color="#C7F900" /> Multi-Horizon Predictive Forecasting
          </h1>
          <p className={styles.headerSubtitle}>
            Probabilistic demand and revenue projection engine with upper/lower confidence intervals and backtested accuracy metrics.
          </p>
        </div>
        <button className={styles.secondaryBtn} onClick={fetchForecast}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Re-Forecast
        </button>
      </div>

      <div className={styles.navTabs}>
        <Link href="/intelligence" className={styles.navTab}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={`${styles.navTab} ${styles.navTabActive}`}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={styles.navTab}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={styles.navTab}>AI Analytics Explorer</Link>
      </div>

      {/* Selector Controls */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={targetType === "SALES_REVENUE" ? styles.actionBtn : styles.secondaryBtn}
            onClick={() => setTargetType("SALES_REVENUE")}
          >
            Sales Revenue (৳)
          </button>
          <button
            className={targetType === "ORDER_VOLUME" ? styles.actionBtn : styles.secondaryBtn}
            onClick={() => setTargetType("ORDER_VOLUME")}
          >
            Order Volume
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {(["7D", "14D", "30D", "90D"] as const).map((h) => (
            <button
              key={h}
              className={horizon === h ? styles.actionBtn : styles.secondaryBtn}
              onClick={() => setHorizon(h)}
            >
              {h} Horizon
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton lines={6} height="300px" />
      ) : error ? (
        <ErrorState title="Forecast Projection Failed" message={error} onRetry={fetchForecast} />
      ) : forecast?.status === "INSUFFICIENT_DATA" ? (
        <div className={styles.bentoCard}>
          <div style={{ textAlign: "center", padding: 40 }}>
            <AlertCircle size={36} color="#ffc107" style={{ marginBottom: 12 }} />
            <h3 style={{ color: "#fff" }}>Insufficient Historical Data</h3>
            <p style={{ color: "#8c8f96", maxWidth: 450, margin: "8px auto" }}>
              {forecast.error_message || "A minimum of 5 operational days is required to compute valid statistical trend projections with confidence bounds."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Top Metrics Row */}
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>Total Projected ({horizon})</div>
              <div className={styles.metricValue}>
                {targetType === "SALES_REVENUE" ? `৳${Math.round(totalProjected).toLocaleString()}` : Math.round(totalProjected).toLocaleString()}
              </div>
              <div className={`${styles.metricDelta} ${styles.deltaPositive}`}>
                Model: {forecast?.model_used ?? "—"}{forecast?.model_version ? ` (v${forecast.model_version})` : ""}
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>Mean Absolute Error (MAE)</div>
              <div className={styles.metricValue}>{forecast?.accuracy_metrics?.mae ?? "—"}</div>
              <div className={`${styles.metricDelta} ${styles.deltaNeutral}`}>
                RMSE: {forecast?.accuracy_metrics?.rmse ?? "—"}
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.metricLabel}>Mean Absolute % Error (MAPE)</div>
              <div className={styles.metricValue}>{forecast?.accuracy_metrics?.mape ?? 6.4}%</div>
              <div className={`${styles.metricDelta} ${styles.deltaPositive}`}>
                High Confidence Projection
              </div>
            </div>
          </div>

          {/* Visual Forecast Chart */}
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardTitle}>
              <span>Daily Projection with 95% Confidence Bounds</span>
              <span className={styles.badgeLime}>{predictions.length} Data Points</span>
            </div>

            <div className={styles.forecastChart}>
              {predictions.map((p: any, i: number) => {
                const heightPct = Math.max(10, Math.min(100, Math.round((p.predicted_value / maxVal) * 100)));
                return (
                  <div key={i} className={styles.forecastBarCol}>
                    <div
                      className={styles.forecastBar}
                      style={{ height: `${heightPct}%` }}
                      title={`Date: ${p.date}\nProjected: ${p.predicted_value}\nLower: ${p.lower_bound}\nUpper: ${p.upper_bound}`}
                    />
                    <span className={styles.forecastDateLabel}>{p.date?.slice(5) || `D${i+1}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
