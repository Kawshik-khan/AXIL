"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Lightbulb, ShieldAlert } from "lucide-react";
import styles from "../intelligence/intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

interface Evidence {
  source_type?: string;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority?: string;
  confidence?: number;
  required_autonomy_level?: number;
  expected_benefit?: { revenue_impact_bdt?: number };
  evidence?: Evidence[];
}

interface Opportunity {
  id: string;
  title: string;
  description: string;
  type: string;
  estimated_impact?: { potential_revenue_bdt?: number };
}

interface Risk {
  id: string;
  title: string;
  description: string;
  severity: string;
}

interface Anomaly {
  probable_cause: string;
  metric: string;
  deviation_score: number;
}

interface Overview {
  top_anomalies?: Anomaly[];
  top_opportunities?: Opportunity[];
  top_risks?: Risk[];
  top_recommendations?: Recommendation[];
}

/** Deeper Insights pages; they are reached from here, not from the dock. */
const MORE_PAGES = [
  { href: "/intelligence/recommendations", label: "All recommendations" },
  { href: "/intelligence/insights", label: "Insights & anomalies" },
  { href: "/intelligence/analytics", label: "Customer segments" },
];

/**
 * Recommendations, opportunities, risks and anomalies from the last 30 days (GET /api/v1/intelligence/overview).
 * This was the Intelligence home page; its revenue, order and AOV cards repeated the Analytics cards and were dropped.
 */
export function RecommendationsTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/intelligence/overview");
      if (!res.ok) throw new Error(`Could not load recommendations (${res.status})`);
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load recommendations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleProposeDecision = async (recId: string) => {
    setProposingId(recId);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/intelligence/recommendations/${recId}/propose-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { source: "EXECUTIVE_DASHBOARD" } }),
      });
      if (!res.ok) throw new Error();
      setNotice({ tone: "ok", text: "Decision proposed and sent for approval." });
      loadData();
    } catch {
      setNotice({ tone: "error", text: "Could not propose this decision. Try again." });
    } finally {
      setProposingId(null);
    }
  };

  if (loading) return <LoadingSkeleton lines={6} height="300px" />;
  if (error) return <ErrorState title="Could not load recommendations" message={error} onRetry={loadData} />;

  const anomalies = data?.top_anomalies ?? [];
  const opportunities = data?.top_opportunities ?? [];
  const risks = data?.top_risks ?? [];
  const recommendations = data?.top_recommendations ?? [];

  return (
    <div>
      <div className={styles.navTabs}>
        {MORE_PAGES.map((p) => (
          <Link key={p.href} href={p.href} className={styles.navTab}>
            {p.label}
          </Link>
        ))}
      </div>

      {notice && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            fontSize: 13,
            color: notice.tone === "ok" ? "var(--color-success-ink)" : "var(--color-danger-ink)",
          }}
        >
          {notice.text}
        </div>
      )}

      {anomalies.length > 0 && (
        <div className={styles.anomalyBanner}>
          <div>
            <div className={styles.bannerTitle}>
              <AlertTriangle size={18} /> {anomalies.length} unusual changes found
            </div>
            <div className={styles.bannerText}>
              {anomalies[0].probable_cause} (Metric: {anomalies[0].metric}, Deviation: {anomalies[0].deviation_score}σ)
            </div>
          </div>
          <Link href="/intelligence/insights" className={styles.actionBtn}>
            See details
          </Link>
        </div>
      )}

      <div className={styles.bentoGrid}>
        <div className={`${styles.bentoCard} ${styles.col8}`}>
          <div className={styles.cardTitle}>
            <span>Recommendations · last 30 days</span>
            <Link
              href="/intelligence/recommendations"
              style={{ color: "var(--color-lime-ink)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              View all ({recommendations.length})
            </Link>
          </div>

          {recommendations.length === 0 ? (
            <EmptyState title="No open recommendations" description="Nothing in your recent orders needs action." />
          ) : (
            recommendations.slice(0, 3).map((rec) => (
              <div key={rec.id} className={styles.recItem}>
                <div className={styles.recTitle}>
                  <span>{rec.title}</span>
                  {rec.priority && (
                    <span className={rec.priority === "CRITICAL" ? styles.badgeRed : styles.badgeYellow}>{rec.priority}</span>
                  )}
                </div>
                <p className={styles.recDesc}>{rec.description}</p>

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
                  {rec.required_autonomy_level !== undefined && (
                    <span className={styles.badgeNeutral}>Level {rec.required_autonomy_level} autonomy</span>
                  )}
                  {rec.evidence?.[0]?.source_type && (
                    <span className={styles.badgeNeutral}>Evidence: {rec.evidence[0].source_type}</span>
                  )}
                </div>

                <div className={styles.actionRow}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleProposeDecision(rec.id)}
                    disabled={proposingId === rec.id}
                  >
                    {proposingId === rec.id ? "Proposing..." : "Propose decision"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={`${styles.bentoCard} ${styles.col4}`}>
          <div className={styles.cardTitle}>
            <span>
              <Lightbulb size={16} color="var(--color-lime-ink)" style={{ marginRight: 6 }} /> Opportunities
            </span>
          </div>

          {opportunities.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "4px 0 12px" }}>None found.</p>
          )}
          {opportunities.slice(0, 2).map((opp) => (
            <div key={opp.id} className={styles.recItem} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{opp.title}</div>
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "4px 0" }}>{opp.description}</p>
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
            <span>
              <ShieldAlert size={16} color="var(--color-danger-ink)" style={{ marginRight: 6 }} /> Risks
            </span>
          </div>

          {risks.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "4px 0" }}>None found.</p>
          )}
          {risks.slice(0, 2).map((risk) => (
            <div key={risk.id} className={styles.recItem} style={{ marginBottom: 8, borderColor: "var(--color-danger)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-danger-ink)" }}>{risk.title}</div>
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "4px 0" }}>{risk.description}</p>
              <span className={styles.badgeRed}>Severity: {risk.severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
