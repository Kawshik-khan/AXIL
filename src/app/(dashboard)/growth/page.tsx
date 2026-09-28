"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Rocket,
  Users,
  Send,
  GitFork,
  BarChart3,
  TestTube,
  Sparkles,
  Play,
  Pause,
  RefreshCw,
  TrendingUp,
  DollarSign,
  ShieldCheck,
  Zap,
} from "lucide-react";
import styles from "./growth.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function GrowthCommandCenterPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [chartViewMode, setChartViewMode] = useState<"count" | "percent">("count");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/growth/overview");
      if (!res.ok) throw new Error(`Failed to load growth overview (${res.status})`);
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message || "Failed to load growth command center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExecuteCampaign = async (campaignId: string) => {
    setActionInProgress(campaignId);
    try {
      const res = await fetch(`/api/v1/growth/campaigns/${campaignId}/execute`, {
        method: "POST",
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Execution failed");
      }
      await loadData();
    } catch (err: any) {
      alert(`Execution error: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.headerTitle}>
              <Rocket size={26} color="var(--color-lime-primary, #C7F900)" /> Growth Command Center
            </h1>
            <p className={styles.headerSubtitle}>Autonomous Marketing, Retention & Lifecycle Engine</p>
          </div>
        </div>
        <LoadingSkeleton lines={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <ErrorState message={error} onRetry={loadData} />
      </div>
    );
  }

  const attribution = data?.attribution_summary;
  const lifecycle = data?.lifecycle_distribution || {};

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Rocket size={26} color="var(--color-lime-primary, #C7F900)" /> Growth Command Center
          </h1>
          <p className={styles.headerSubtitle}>
            Autonomous multi-channel marketing, predictive segmentation, and customer retention
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={loadData}>
            <RefreshCw size={14} /> Refresh
          </button>
          <Link href="/growth/campaigns" className={`${styles.btn} ${styles.btnPrimary}`}>
            <Send size={14} /> New Campaign
          </Link>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className={styles.navTabs}>
        <Link href="/growth" className={`${styles.navTab} ${styles.navTabActive}`}>
          Command Center
        </Link>
        <Link href="/growth/audiences" className={styles.navTab}>
          Audiences
        </Link>
        <Link href="/growth/campaigns" className={styles.navTab}>
          Campaigns
        </Link>
        <Link href="/growth/journeys" className={styles.navTab}>
          Journeys
        </Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>
          Lifecycle
        </Link>
        <Link href="/growth/attribution" className={styles.navTab}>
          Attribution
        </Link>
        <Link href="/growth/experiments" className={styles.navTab}>
          A/B Experiments
        </Link>
      </div>

      {/* Top Bento KPI Metrics */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Attributed Revenue</span>
            <DollarSign size={16} color="var(--color-lime-primary, #C7F900)" />
          </div>
          <div className={styles.metricValue}>
            ৳{(attribution?.total_attributed_revenue_bdt || 0).toLocaleString()}
          </div>
          <div className={styles.metricSubtext}>
            <span className={styles.metricSubtext}>Incremental lift not measured (needs a control group)</span>
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Active Campaigns</span>
            <Send size={16} color="#3b82f6" />
          </div>
          <div className={styles.metricValue}>
            {data?.active_campaigns_count || 0}
          </div>
          <div className={styles.metricSubtext}>
            <span>Across WhatsApp, IG, Messenger</span>
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Audience Segments</span>
            <Users size={16} color="#f59e0b" />
          </div>
          <div className={styles.metricValue}>
            {data?.audiences_count || 0}
          </div>
          <div className={styles.metricSubtext}>
            <span>Dynamic & predictive rule groups</span>
          </div>
        </div>

        <div className={`${styles.bentoCard} ${styles.col3}`}>
          <div className={styles.metricLabel}>
            <span>Blended ROAS</span>
            <TrendingUp size={16} color="var(--color-lime-primary, #C7F900)" />
          </div>
          <div className={styles.metricValue}>
            {typeof attribution?.blended_roas === "number" ? `${attribution.blended_roas}x` : "—"}
          </div>
          <div className={styles.metricSubtext}>
            <span className={styles.metricSubtext}>Attributed revenue ÷ campaign spend</span>
          </div>
        </div>
      </div>

      {/* Middle Bento Section: Lifecycle Funnel & AI Recommendations */}
      <div className={styles.bentoGrid}>
        {/* Customer Lifecycle Funnel Bar Chart */}
        <div className={`${styles.bentoCard} ${styles.col7}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div className={styles.cardTitle}>
                <BarChart3 size={18} color="var(--color-lime-primary, #C7F900)" /> Customer Lifecycle Funnel
              </div>
              <div className={styles.cardSubtitle}>
                10-stage deterministic state distribution across active customers
              </div>
            </div>

            {/* Quick Chart Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  display: "inline-flex",
                  background: "var(--color-surface-soft, #FAFBF8)",
                  border: "1px solid var(--color-border-subtle, rgba(30, 32, 30, 0.08))",
                  borderRadius: "8px",
                  padding: "2px",
                }}
              >
                <button
                  onClick={() => setChartViewMode("count")}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    background: chartViewMode === "count" ? "var(--color-surface-pure, #ffffff)" : "transparent",
                    color: chartViewMode === "count" ? "var(--color-text-primary, #202124)" : "var(--color-text-secondary, #70736F)",
                    boxShadow: chartViewMode === "count" ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  Count
                </button>
                <button
                  onClick={() => setChartViewMode("percent")}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    background: chartViewMode === "percent" ? "var(--color-surface-pure, #ffffff)" : "transparent",
                    color: chartViewMode === "percent" ? "var(--color-text-primary, #202124)" : "var(--color-text-secondary, #70736F)",
                    boxShadow: chartViewMode === "percent" ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  % Ratio
                </button>
              </div>

              {(() => {
                const stages = [
                  { key: "NEW", count: lifecycle.NEW || 0 },
                  { key: "FIRST_PURCHASE", count: lifecycle.FIRST_PURCHASE || 0 },
                  { key: "ACTIVE", count: lifecycle.ACTIVE || 0 },
                  { key: "REPEAT", count: lifecycle.REPEAT || 0 },
                  { key: "LOYAL", count: lifecycle.LOYAL || 0 },
                  { key: "AT_RISK", count: lifecycle.AT_RISK || 0 },
                  { key: "DORMANT", count: lifecycle.DORMANT || 0 },
                  { key: "REACTIVATED", count: lifecycle.REACTIVATED || 0 },
                ];
                const total = stages.reduce((acc, s) => acc + s.count, 0);
                return (
                  <div
                    style={{
                      padding: "4px 10px",
                      borderRadius: "8px",
                      background: "rgba(199, 249, 0, 0.15)",
                      border: "1px solid rgba(199, 249, 0, 0.4)",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#283600",
                    }}
                  >
                    {total.toLocaleString()} Active Funnel Cohort
                  </div>
                );
              })()}
            </div>
          </div>

          {(() => {
            const stageConfig = [
              {
                key: "NEW",
                label: "New",
                fullName: "New Accounts",
                count: lifecycle.NEW || 0,
                color: "#3b82f6",
                colorDark: "#1d4ed8",
                glow: "rgba(59, 130, 246, 0.35)",
                rule: "Signed up recently with zero purchase history",
              },
              {
                key: "FIRST_PURCHASE",
                label: "1st Buy",
                fullName: "First-Time Buyers",
                count: lifecycle.FIRST_PURCHASE || 0,
                color: "#0ea5e9",
                colorDark: "#0284c7",
                glow: "rgba(14, 165, 233, 0.35)",
                rule: "Completed their first purchase within last 14 days",
              },
              {
                key: "ACTIVE",
                label: "Active",
                fullName: "Active Purchasers",
                count: lifecycle.ACTIVE || 0,
                color: "#14b8a6",
                colorDark: "#0d9488",
                glow: "rgba(20, 184, 166, 0.35)",
                rule: "Recent purchasers (15–45 days) with high affinity",
              },
              {
                key: "REPEAT",
                label: "Repeat",
                fullName: "Repeat Buyers",
                count: lifecycle.REPEAT || 0,
                color: "#84cc16",
                colorDark: "#65a30d",
                glow: "rgba(132, 204, 22, 0.35)",
                rule: "Placed 2–4 verified orders. Strong brand affinity signals",
              },
              {
                key: "LOYAL",
                label: "Loyal",
                fullName: "VIP Champions",
                count: lifecycle.LOYAL || 0,
                color: "#10b981",
                colorDark: "#059669",
                glow: "rgba(16, 185, 129, 0.35)",
                rule: "5+ orders or lifetime customer value > ৳25,000",
              },
              {
                key: "AT_RISK",
                label: "At Risk",
                fullName: "At-Risk Cohort",
                count: lifecycle.AT_RISK || 0,
                color: "#f59e0b",
                colorDark: "#d97706",
                glow: "rgba(245, 158, 11, 0.35)",
                rule: "No orders placed for 30–60 days. Churn risk escalating",
              },
              {
                key: "DORMANT",
                label: "Dormant",
                fullName: "Dormant Buyers",
                count: lifecycle.DORMANT || 0,
                color: "#ef4444",
                colorDark: "#dc2626",
                glow: "rgba(239, 68, 68, 0.35)",
                rule: "Inactive for > 60 days. Requires proactive win-back outreach",
              },
              {
                key: "REACTIVATED",
                label: "Reactivated",
                fullName: "Won-Back Buyers",
                count: lifecycle.REACTIVATED || 0,
                color: "#a855f7",
                colorDark: "#7e22ce",
                glow: "rgba(168, 85, 247, 0.35)",
                rule: "Previously inactive buyers who placed an order in last 14 days",
              },
            ];

            const total = stageConfig.reduce((acc, s) => acc + s.count, 0);
            const maxVal = Math.max(...stageConfig.map((s) => s.count), 1);
            const activeStage =
              stageConfig.find((s) => s.key === hoveredStage) ||
              stageConfig.reduce((max, s) => (s.count > max.count ? s : max), stageConfig[2]);

            return (
              <div className={styles.lifecycleChartWrapper}>
                {/* Bar Chart Canvas with Reference Gridlines */}
                <div className={styles.chartCanvas}>
                  <div className={styles.chartGridline} style={{ bottom: "100%" }}>
                    <span className={styles.chartGridLabel}>
                      {chartViewMode === "count" ? maxVal : "100%"}
                    </span>
                  </div>
                  <div className={styles.chartGridline} style={{ bottom: "75%" }}>
                    <span className={styles.chartGridLabel}>
                      {chartViewMode === "count" ? Math.round(maxVal * 0.75) : "75%"}
                    </span>
                  </div>
                  <div className={styles.chartGridline} style={{ bottom: "50%" }}>
                    <span className={styles.chartGridLabel}>
                      {chartViewMode === "count" ? Math.round(maxVal * 0.5) : "50%"}
                    </span>
                  </div>
                  <div className={styles.chartGridline} style={{ bottom: "25%" }}>
                    <span className={styles.chartGridLabel}>
                      {chartViewMode === "count" ? Math.round(maxVal * 0.25) : "25%"}
                    </span>
                  </div>
                  <div className={styles.chartGridline} style={{ bottom: "0%" }}>
                    <span className={styles.chartGridLabel}>0</span>
                  </div>

                  {/* 7 Vertical Bar Columns */}
                  {stageConfig.map((item) => {
                    const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                    const fillHeightPct = maxVal > 0 ? Math.round((item.count / maxVal) * 100) : 0;
                    const isHovered = hoveredStage === item.key;
                    const isDimmed = hoveredStage !== null && !isHovered;

                    return (
                      <div
                        key={item.key}
                        className={styles.barCol}
                        style={{ opacity: isDimmed ? 0.4 : 1 }}
                        onMouseEnter={() => setHoveredStage(item.key)}
                        onMouseLeave={() => setHoveredStage(null)}
                      >
                        {/* Value Badge above Bar */}
                        <div className={styles.barValuePill}>
                          <span className={styles.barCountText}>
                            {chartViewMode === "count" ? item.count.toLocaleString() : `${pct}%`}
                          </span>
                          {chartViewMode === "count" && (
                            <span className={styles.barPctBadge}>{pct}%</span>
                          )}
                        </div>

                        {/* Bar Pillar */}
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFill}
                            style={{
                              height: `${Math.max(6, fillHeightPct)}%`,
                              background: `linear-gradient(180deg, ${item.color} 0%, ${item.colorDark} 100%)`,
                              boxShadow: isHovered ? `0 0 16px ${item.glow}` : `0 2px 6px ${item.glow}`,
                            }}
                          />
                        </div>

                        {/* X-Axis Stage Label */}
                        <div className={styles.barAxisLabels}>
                          <span className={styles.barStageName}>{item.label}</span>
                          <span className={styles.barIndicatorDot} style={{ background: item.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Interactive Dynamic Cohort Summary Drawer */}
                {activeStage && (
                  <div className={styles.cohortHoverCard}>
                    <div className={styles.cohortInfoLeft}>
                      <div
                        className={styles.cohortStageTag}
                        style={{
                          background: `${activeStage.color}15`,
                          color: activeStage.colorDark,
                          border: `1px solid ${activeStage.color}35`,
                        }}
                      >
                        {activeStage.fullName}
                      </div>
                      <div className={styles.cohortRuleDesc}>
                        <strong>{activeStage.count.toLocaleString()} customers</strong> (
                        {total > 0 ? Math.round((activeStage.count / total) * 100) : 0}% of cohort)
                        {" · "}
                        <span>{activeStage.rule}</span>
                      </div>
                    </div>

                    <Link
                      href="/growth/audiences"
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--color-text-primary, #202124)",
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "5px 10px",
                        borderRadius: "8px",
                        background: "rgba(0, 0, 0, 0.04)",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Target Cohort →
                    </Link>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Explainable Growth Recommendations (AI Highlight Card) */}
        <div className={`${styles.bentoCardAI} ${styles.col5}`}>
          <div className={styles.cardTitle}>
            <Sparkles size={18} color="var(--color-lime-primary, #C7F900)" /> AI Growth Interventions
          </div>
          <div className={styles.cardSubtitle}>
            Evidence-backed growth recommendations with projected ROI
          </div>

          <div className={styles.itemList}>
            {(data?.top_recommendations || []).map((rec: any) => (
              <div
                key={rec.id}
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div className={styles.itemMain}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{rec.title}</div>
                  <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.65)" }}>
                    {typeof rec.expected_impact?.projected_revenue_bdt === "number"
                      ? `Projected: +৳${rec.expected_impact.projected_revenue_bdt.toLocaleString()}${typeof rec.expected_impact.projected_roi_multiplier === "number" ? ` • ${rec.expected_impact.projected_roi_multiplier}x ROI` : ""}`
                      : "Impact not estimated"}
                  </div>
                </div>
                <span className={`${styles.statusPill} ${rec.action_risk_level === "HIGH" ? styles.statusReview : styles.statusRunning}`}>
                  {rec.action_risk_level}
                </span>
              </div>
            ))}
            {(!data?.top_recommendations || data.top_recommendations.length === 0) && (
              <div style={{ padding: "28px", textAlign: "center", color: "rgba(255, 255, 255, 0.6)", fontSize: "13px" }}>
                ✦ AI analyzing customer behavior patterns...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bento: Recent Campaigns & Canonical Workflows */}
      <div className={styles.bentoGrid}>
        {/* Recent Campaigns Cockpit */}
        <div className={`${styles.bentoCard} ${styles.col8}`}>
          <div className={styles.cardTitle}>
            <Send size={18} color="var(--color-lime-primary, #C7F900)" /> Campaigns Cockpit
          </div>
          <div className={styles.cardSubtitle}>
            Governed marketing campaigns across Bangladeshi commerce channels
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Attributed Rev</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_campaigns || []).map((cmp: any) => (
                  <tr key={cmp.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{cmp.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)" }}>{cmp.objective}</div>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>{cmp.channel}</span>
                    </td>
                    <td>
                      <span className={`${styles.statusPill} ${cmp.status === "RUNNING" ? styles.statusRunning : cmp.status === "REVIEW" ? styles.statusReview : styles.statusDraft}`}>
                        {cmp.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: cmp.risk_class === "HIGH" ? "var(--color-danger, #ef4444)" : "var(--color-success, #10b981)" }}>
                        {cmp.risk_class}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {typeof cmp.result_metrics?.attributed_revenue_bdt === "number"
                        ? `৳${cmp.result_metrics.attributed_revenue_bdt.toLocaleString()}`
                        : "Not measured"}
                    </td>
                    <td>
                      {cmp.status === "APPROVED" || cmp.status === "SCHEDULED" ? (
                        <button
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          style={{ padding: "4px 10px", fontSize: "11px" }}
                          disabled={actionInProgress === cmp.id}
                          onClick={() => handleExecuteCampaign(cmp.id)}
                        >
                          <Play size={10} /> {actionInProgress === cmp.id ? "Sending..." : "Execute"}
                        </button>
                      ) : (
                        <Link href={`/growth/campaigns`} style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary, #202124)", textDecoration: "underline" }}>
                          View
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data?.recent_campaigns || data.recent_campaigns.length === 0) && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-secondary, #70736F)", padding: "28px" }}>
                      No campaigns created yet. Click New Campaign to begin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Canonical Workflows */}
        <div className={`${styles.bentoCard} ${styles.col4}`}>
          <div className={styles.cardTitle}>
            <Zap size={18} color="var(--color-lime-primary, #C7F900)" /> Canonical Workflows
          </div>
          <div className={styles.cardSubtitle}>
            Pre-wired autonomous lifecycle triggers
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { name: "Abandoned Cart Recovery", channel: "WhatsApp", trigger: "Cart abandoned >60m" },
              { name: "VIP Dormancy Win-Back", channel: "WhatsApp", trigger: "Inactive >45 days" },
              { name: "Post-Delivery Cross-Sell", channel: "Messenger", trigger: "3 days post-delivery" },
              { name: "Daily Growth Brief", channel: "Telegram", trigger: "Scheduled 09:00 BST" },
            ].map((wf, idx) => (
              <div
                key={idx}
                style={{
                  background: "var(--color-surface-soft, #FAFBF8)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--color-border-subtle, rgba(30, 32, 30, 0.08))",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>{wf.name}</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", marginTop: "3px" }}>
                  Channel: <span style={{ fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>{wf.channel}</span> • {wf.trigger}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
