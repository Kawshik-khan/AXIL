"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Lightbulb, ShieldAlert, Sparkles, RefreshCw, FileText } from "lucide-react";
import styles from "../intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function InsightsExplorerPage() {
  const [activeTab, setActiveTab] = useState<"ANOMALIES" | "OPPORTUNITIES" | "RISKS">("ANOMALIES");
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [anomRes, oppRes, riskRes] = await Promise.all([
        fetch("/api/v1/intelligence/anomalies"),
        fetch("/api/v1/intelligence/opportunities"),
        fetch("/api/v1/intelligence/risks"),
      ]);

      const [anomJson, oppJson, riskJson] = await Promise.all([
        anomRes.json(),
        oppRes.json(),
        riskRes.json(),
      ]);

      setAnomalies(anomJson.data?.anomalies || []);
      setOpportunities(oppJson.data?.opportunities || []);
      setRisks(riskJson.data?.risks || []);
    } catch (err: any) {
      setError(err.message || "Failed to load insights");
    } finally {
      setLoading(false);
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
            <Sparkles size={24} color="#C7F900" /> Insights & Anomaly Explorer
          </h1>
          <p className={styles.headerSubtitle}>
            Statistical anomaly detection, verified revenue opportunities, and proactive commerce risk monitoring.
          </p>
        </div>
        <button className={styles.secondaryBtn} onClick={loadData}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> Refresh
        </button>
      </div>

      <div className={styles.navTabs}>
        <Link href="/intelligence" className={styles.navTab}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={`${styles.navTab} ${styles.navTabActive}`}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={styles.navTab}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={styles.navTab}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={styles.navTab}>AI Analytics Explorer</Link>
      </div>

      {/* Internal Tab Filter */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button
          className={activeTab === "ANOMALIES" ? styles.actionBtn : styles.secondaryBtn}
          onClick={() => setActiveTab("ANOMALIES")}
        >
          <AlertTriangle size={14} style={{ marginRight: 6 }} /> Anomalies ({anomalies.length})
        </button>
        <button
          className={activeTab === "OPPORTUNITIES" ? styles.actionBtn : styles.secondaryBtn}
          onClick={() => setActiveTab("OPPORTUNITIES")}
        >
          <Lightbulb size={14} style={{ marginRight: 6 }} /> Opportunities ({opportunities.length})
        </button>
        <button
          className={activeTab === "RISKS" ? styles.actionBtn : styles.secondaryBtn}
          onClick={() => setActiveTab("RISKS")}
        >
          <ShieldAlert size={14} style={{ marginRight: 6 }} /> Operational Risks ({risks.length})
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton lines={5} height="260px" />
      ) : error ? (
        <ErrorState title="Insights Unavailable" message={error} onRetry={loadData} />
      ) : activeTab === "ANOMALIES" ? (
        anomalies.length === 0 ? (
          <EmptyState title="Zero Anomalies" description="No statistical deviations or operational shocks detected." />
        ) : (
          <div className={styles.bentoGrid}>
            {anomalies.map((anom) => (
              <div key={anom.id} className={`${styles.bentoCard} ${styles.col6}`}>
                <div className={styles.cardTitle}>
                  <span>Metric: {anom.metric}</span>
                  <span className={anom.severity === "HIGH" ? styles.badgeRed : styles.badgeYellow}>
                    {anom.severity} ({anom.deviation_score > 0 ? "+" : ""}{anom.deviation_score}σ)
                  </span>
                </div>
                <p className={styles.recDesc}>{anom.probable_cause}</p>
                <div className={styles.badgeRow}>
                  <span className={styles.badgeNeutral}>Current: {anom.current_value}</span>
                  <span className={styles.badgeNeutral}>Baseline: {anom.expected_value}</span>
                  <span className={styles.badgeNeutral}>Method: {anom.detection_method}</span>
                </div>
                {anom.evidence?.[0] && (
                  <div style={{ marginTop: 8, padding: 10, background: "rgba(255, 255, 255, 0.03)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#C7F900", fontWeight: 600 }}>CITED EVIDENCE</div>
                    <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>{anom.evidence[0].description}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : activeTab === "OPPORTUNITIES" ? (
        opportunities.length === 0 ? (
          <EmptyState title="No Open Opportunities" description="Scan again after collecting further operational transactions." />
        ) : (
          <div className={styles.bentoGrid}>
            {opportunities.map((opp) => (
              <div key={opp.id} className={`${styles.bentoCard} ${styles.col6}`}>
                <div className={styles.cardTitle}>
                  <span>{opp.title}</span>
                  <span className={styles.badgeLime}>{typeof opp.confidence === "number" ? `${Math.round(opp.confidence * 100)}% Conf` : "Conf —"}</span>
                </div>
                <p className={styles.recDesc}>{opp.description}</p>
                <div className={styles.badgeRow}>
                  <span className={styles.badgeLime}>Estimated Gain: +৳{opp.estimated_impact?.potential_revenue_bdt?.toLocaleString() || 0}</span>
                  <span className={styles.badgeNeutral}>Orders: +{opp.estimated_impact?.potential_orders || 0}</span>
                  <span className={styles.badgeNeutral}>Type: {opp.type}</span>
                </div>
                {opp.evidence?.[0] && (
                  <div style={{ marginTop: 8, padding: 10, background: "rgba(255, 255, 255, 0.03)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#C7F900", fontWeight: 600 }}>EVIDENCE CITATION</div>
                    <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>{opp.evidence[0].description}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        risks.length === 0 ? (
          <EmptyState title="Zero Detected Risks" description="No impending stockout or customer churn risks identified." />
        ) : (
          <div className={styles.bentoGrid}>
            {risks.map((risk) => (
              <div key={risk.id} className={`${styles.bentoCard} ${styles.col6}`}>
                <div className={styles.cardTitle}>
                  <span style={{ color: "#ff6b6b" }}>{risk.title}</span>
                  <span className={styles.badgeRed}>{risk.severity}</span>
                </div>
                <p className={styles.recDesc}>{risk.description}</p>
                <div className={styles.badgeRow}>
                  <span className={styles.badgeRed}>Exposure: ৳{risk.estimated_impact?.potential_revenue_loss_bdt?.toLocaleString() || 0}</span>
                  <span className={styles.badgeNeutral}>Category: {risk.type}</span>
                </div>
                {risk.evidence?.[0] && (
                  <div style={{ marginTop: 8, padding: 10, background: "rgba(255, 255, 255, 0.03)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#ff6b6b", fontWeight: 600 }}>RISK SIGNAL</div>
                    <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>{risk.evidence[0].description}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
