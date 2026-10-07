"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, CheckCircle, Clock, XCircle, ArrowRight, RefreshCw, AlertTriangle } from "lucide-react";
import styles from "../intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadRecs = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter === "ALL"
        ? "/api/v1/intelligence/recommendations"
        : `/api/v1/intelligence/recommendations?status=${statusFilter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load recommendations");
      const json = await res.json();
      setRecommendations(json.data?.recommendations || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch recommendations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecs();
  }, [statusFilter]);

  const handleProposeDecision = async (id: string) => {
    setSubmittingId(id);
    try {
      const res = await fetch(`/api/v1/intelligence/recommendations/${id}/propose-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { origin: "RECOMMENDATIONS_VIEW" } }),
      });
      if (res.ok) {
        alert("Action sent for approval.");
        loadRecs();
      } else {
        alert("Failed to submit proposal.");
      }
    } catch {
      alert("Error submitting proposal.");
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Sparkles size={24} color="#C7F900" /> Explainable Recommendations & Decisions
          </h1>
          <p className={styles.headerSubtitle}>
            Evidence-backed proposals with explicit impact forecasts, trade-off warnings, and approval routing.
          </p>
        </div>
        <button className={styles.secondaryBtn} onClick={loadRecs}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Refresh
        </button>
      </div>

      <div className={styles.navTabs}>
        <Link href="/intelligence" className={styles.navTab}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={styles.navTab}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={`${styles.navTab} ${styles.navTabActive}`}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={styles.navTab}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={styles.navTab}>AI Analytics Explorer</Link>
      </div>

      {/* Status Filter Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {["ALL", "PROPOSED", "REVIEWING", "APPROVED", "EXECUTED", "REJECTED"].map((s) => (
          <button
            key={s}
            className={statusFilter === s ? styles.actionBtn : styles.secondaryBtn}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton lines={5} height="280px" />
      ) : error ? (
        <ErrorState title="Unable to Load" message={error} onRetry={loadRecs} />
      ) : recommendations.length === 0 ? (
        <EmptyState title="No Recommendations Found" description="Try selecting a different status filter or run new telemetry scans." />
      ) : (
        <div className={styles.bentoGrid}>
          {recommendations.map((rec) => (
            <div key={rec.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardTitle}>
                <span>{rec.title}</span>
                <span className={rec.status === "APPROVED" ? styles.badgeLime : styles.badgeYellow}>
                  {rec.status}
                </span>
              </div>
              <p className={styles.recDesc}>{rec.description}</p>

              {/* Rationale & Root Cause */}
              <div style={{ fontSize: 12, color: "#8c8f96", marginBottom: 12 }}>
                <strong style={{ color: "#ededed" }}>Rationale:</strong> {rec.rationale}
              </div>

              {/* 7-Factor Explainability Matrix */}
              <div className={styles.badgeRow}>
                <span className={styles.badgeLime}>
                  {typeof rec.expected_benefit?.revenue_impact_bdt === "number"
                    ? `+৳${rec.expected_benefit.revenue_impact_bdt.toLocaleString()}`
                    : "Impact not estimated"}
                </span>
                <span className={styles.badgeNeutral}>
                  Conf: {typeof rec.confidence === "number" ? `${Math.round(rec.confidence * 100)}%` : "—"}
                </span>
                <span className={styles.badgeNeutral}>Risk: {rec.action_risk_level ?? "—"}</span>
                <span className={styles.badgeNeutral}>Autonomy Level {rec.required_autonomy_level ?? "—"}</span>
                <span className={styles.badgeNeutral}>{rec.required_approval ? "Needs approval" : "No approval needed"}</span>
              </div>

              {/* Trade-Off Warning (if any) */}
              {Array.isArray(rec.risks) && rec.risks.length > 0 && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--color-warning)", marginBottom: 14 }}>
                  <AlertTriangle size={14} />
                  <span>Trade-off: {rec.risks.join("; ")}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className={styles.actionRow}>
                {rec.status === "PROPOSED" && (
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleProposeDecision(rec.id)}
                    disabled={submittingId === rec.id}
                  >
                    {submittingId === rec.id ? "Proposing..." : "Propose Decision"}
                  </button>
                )}
                <Link href="/intelligence/simulation" className={styles.secondaryBtn}>
                  Simulate Impact
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
