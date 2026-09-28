"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Play,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import styles from "./intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function IntelligenceExecutivePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/intelligence/overview");
      if (!res.ok) throw new Error(`Failed to load intelligence data (${res.status})`);
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message || "Failed to load intelligence dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleProposeDecision = async (recId: string) => {
    setProposingId(recId);
    try {
      const res = await fetch(`/api/v1/intelligence/recommendations/${recId}/propose-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { source: "EXECUTIVE_DASHBOARD" } }),
      });
      if (res.ok) {
        alert("Decision proposed successfully and submitted to Phase 5 Approval Engine!");
        loadData();
      } else {
        alert("Failed to propose decision.");
      }
    } catch (err) {
      alert("Error submitting proposal.");
    } finally {
      setProposingId(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.headerTitle}><Sparkles size={24} color="#C7F900" /> Commerce Intelligence & Decision Engine</h1>
            <p className={styles.headerSubtitle}>Authoritative pattern detection, predictive forecasting, and autonomous decisioning.</p>
          </div>
        </div>
        <LoadingSkeleton lines={6} height="300px" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <ErrorState title="Failed to Load Intelligence" message={error} onRetry={loadData} />
      </div>
    );
  }

  const sales = data?.sales || {};
  // A computed change, or an honest "no comparison" (FX-30; these were literal +12.4% / +8.1%)
  const changeLabel = (value: number | null | undefined, suffix: string) =>
    value === null || value === undefined ? (
      <span className={styles.deltaNeutral}>No sales in the previous period to compare</span>
    ) : (
      <span className={value >= 0 ? styles.deltaPositive : styles.deltaNegative}>
        {value >= 0 ? <ArrowUpRight size={14} /> : null} {value >= 0 ? "+" : ""}
        {value}% {suffix}
      </span>
    );
  const aov = sales.total_orders > 0 ? Math.round(sales.total_revenue_bdt / sales.total_orders) : 0;
  const anomalies = data?.top_anomalies || [];
  const opportunities = data?.top_opportunities || [];
  const risks = data?.top_risks || [];
  const recommendations = data?.top_recommendations || [];

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Sparkles size={26} color="#C7F900" /> Commerce Intelligence & Decision Engine
          </h1>
          <p className={styles.headerSubtitle}>
            Continuous pattern detection, probabilistic forecasting, and evidence-backed autonomous decisions.
          </p>
        </div>
        <button className={styles.secondaryBtn} onClick={loadData}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Refresh State
        </button>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className={styles.navTabs}>
        <Link href="/intelligence" className={`${styles.navTab} ${styles.navTabActive}`}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={styles.navTab}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={styles.navTab}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={styles.navTab}>AI Analytics Explorer</Link>
      </div>

      {/* Anomaly Alert Banner (if any detected) */}
      {anomalies.length > 0 && (
        <div className={styles.anomalyBanner}>
          <div>
            <div className={styles.bannerTitle}>
              <AlertTriangle size={18} /> {anomalies.length} Operational Anomalies Detected
            </div>
            <div className={styles.bannerText}>
              {anomalies[0].probable_cause} (Metric: {anomalies[0].metric}, Deviation: {anomalies[0].deviation_score}σ)
            </div>
          </div>
          <Link href="/intelligence/insights" className={styles.actionBtn}>
            Inspect Evidence
          </Link>
        </div>
      )}

      {/* Bento Grid Row 1: Executive KPIs */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>30-Day Revenue</span>
            <TrendingUp size={16} color="#C7F900" />
          </div>
          <div className={styles.metricValue}>৳{sales.total_revenue_bdt?.toLocaleString() || 0}</div>
          <div className={styles.metricDelta}>
            {changeLabel(data?.comparison?.revenue_change_pct, "vs previous 30 days")}
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Order Volume</span>
            <span className={styles.badgeLime}>Active</span>
          </div>
          <div className={styles.metricValue}>{sales.total_orders || 0}</div>
          <div className={styles.metricDelta}>
            {changeLabel(data?.comparison?.orders_change_pct, "vs previous 30 days")}
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Average Order Value</span>
            <span className={styles.badgeNeutral}>BDT</span>
          </div>
          <div className={styles.metricValue}>৳{aov.toLocaleString()}</div>
          <div className={`${styles.metricDelta} ${styles.deltaNeutral}`}>
            Last 30 days
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Delivery success</span>
            <span className={styles.badgeLime}>Shipments</span>
          </div>
          <div className={styles.metricValue}>
            {data?.delivery?.success_rate_pct === null || data?.delivery?.success_rate_pct === undefined
              ? "—"
              : `${data.delivery.success_rate_pct}%`}
          </div>
          <div className={`${styles.metricDelta} ${styles.deltaNeutral}`}>
            {data?.delivery
              ? `${data.delivery.delivered} delivered, ${data.delivery.unsuccessful} returned or failed`
              : "No shipments yet"}
          </div>
        </div>
      </div>

      {/* Bento Grid Row 2: Top Recommendations & Opportunities */}
      <div className={styles.bentoGrid}>
        {/* Grounded Recommendations */}
        <div className={`${styles.bentoCard} ${styles.col8}`}>
          <div className={styles.cardTitle}>
            <span>🎯 Grounded Optimization Proposals</span>
            <Link href="/intelligence/recommendations" style={{ color: "#C7F900", fontSize: 13, textDecoration: "none" }}>
              View All ({recommendations.length})
            </Link>
          </div>

          {recommendations.length === 0 ? (
            <EmptyState title="No Open Recommendations" description="Commerce state is operating within normal baseline limits." />
          ) : (
            recommendations.slice(0, 3).map((rec: any) => (
              <div key={rec.id} className={styles.recItem}>
                <div className={styles.recTitle}>
                  <span>{rec.title}</span>
                  <span className={rec.priority === "CRITICAL" ? styles.badgeRed : styles.badgeYellow}>
                    {rec.priority}
                  </span>
                </div>
                <p className={styles.recDesc}>{rec.description}</p>

                {/* 7-Factor Explainability Badges */}
                <div className={styles.badgeRow}>
                  <span className={styles.badgeLime}>
                    Impact:{" "}
                    {typeof rec.expected_benefit?.revenue_impact_bdt === "number"
                      ? `+৳${rec.expected_benefit.revenue_impact_bdt.toLocaleString()}`
                      : "not estimated"}
                  </span>
                  <span className={styles.badgeNeutral}>
                    Confidence: {typeof rec.confidence === "number" ? `${Math.round(rec.confidence * 100)}%` : "—"}
                  </span>
                  <span className={styles.badgeNeutral}>Level {rec.required_autonomy_level} Autonomy</span>
                  {rec.evidence?.[0] && (
                    <span className={styles.badgeNeutral}>Evidence: {rec.evidence[0].source_type}</span>
                  )}
                </div>

                <div className={styles.actionRow}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleProposeDecision(rec.id)}
                    disabled={proposingId === rec.id}
                  >
                    {proposingId === rec.id ? "Proposing..." : "Propose Decision"}
                  </button>
                  <Link href={`/intelligence/simulation`} className={styles.secondaryBtn}>
                    Simulate What-If
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Growth Opportunities & Operational Risks */}
        <div className={`${styles.bentoCard} ${styles.col4}`}>
          <div className={styles.cardTitle}>
            <span><Lightbulb size={16} color="#C7F900" style={{ marginRight: 6 }} /> Opportunities</span>
          </div>

          {opportunities.slice(0, 2).map((opp: any) => (
            <div key={opp.id} className={styles.recItem} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{opp.title}</div>
              <p style={{ fontSize: 12, color: "#a0a4ab", margin: "4px 0" }}>{opp.description}</p>
              <div className={styles.badgeRow}>
                <span className={styles.badgeLime}>
                  {typeof opp.estimated_impact?.potential_revenue_bdt === "number"
                    ? `৳${opp.estimated_impact.potential_revenue_bdt.toLocaleString()}`
                    : "Value not estimated"}
                </span>
                <span className={styles.badgeNeutral}>{opp.type}</span>
              </div>
            </div>
          ))}

          <div className={styles.cardTitle} style={{ marginTop: 16 }}>
            <span><ShieldAlert size={16} color="#ff6b6b" style={{ marginRight: 6 }} /> Active Risks</span>
          </div>

          {risks.slice(0, 2).map((risk: any) => (
            <div key={risk.id} className={styles.recItem} style={{ marginBottom: 8, borderColor: "rgba(255, 82, 82, 0.2)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ff6b6b" }}>{risk.title}</div>
              <p style={{ fontSize: 12, color: "#a0a4ab", margin: "4px 0" }}>{risk.description}</p>
              <span className={styles.badgeRed}>Severity: {risk.severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
