"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { TestTube, Trophy, CheckCircle, Sparkles, AlertCircle } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton, EmptyState } from "@/components/ui/States/States";

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);

  const loadExperiments = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/growth/experiments");
      if (res.ok) {
        const json = await res.json();
        setExperiments(json.data.experiments || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExperiments();
  }, []);

  const handleEvaluate = async (id: string) => {
    setEvaluatingId(id);
    try {
      const res = await fetch(`/api/v1/growth/experiments/${id}/evaluate`, { method: "POST" });
      if (res.ok) await loadExperiments();
    } finally {
      setEvaluatingId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <TestTube size={26} color="var(--color-lime-primary, #C7F900)" /> A/B Testing & Experimentation
          </h1>
          <p className={styles.headerSubtitle}>
            Statistically-grounded experiments with sample size guards and p-value validation
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={styles.navTab}>Audiences</Link>
        <Link href="/growth/campaigns" className={styles.navTab}>Campaigns</Link>
        <Link href="/growth/journeys" className={styles.navTab}>Journeys</Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>Lifecycle</Link>
        <Link href="/growth/attribution" className={styles.navTab}>Attribution</Link>
        <Link href="/growth/experiments" className={`${styles.navTab} ${styles.navTabActive}`}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : experiments.length === 0 ? (
        <EmptyState title="No Experiments Created" description="Launch an A/B test to scientifically test copy, offers, and send timings." />
      ) : (
        <div className={styles.bentoGrid}>
          {experiments.map((exp) => (
            <div key={exp.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>{exp.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>Hypothesis: {exp.hypothesis}</div>
                </div>
                <span className={`${styles.statusPill} ${exp.status === "COMPLETED" ? styles.statusActive : styles.statusRunning}`}>
                  {exp.status}
                </span>
              </div>

              {/* Variants Breakdown */}
              <div style={{ margin: "14px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                {(exp.variants || []).map((v: any) => (
                  <div key={v.variant_id} style={{ background: "var(--color-surface-soft, #FAFBF8)", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary, #202124)" }}>{v.name}</span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", marginLeft: "8px" }}>({v.traffic_allocation_pct}% traffic)</span>
                    </div>
                    {exp.result?.winning_variant_id === v.variant_id && (
                      <span className={styles.badgePositive} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Trophy size={12} /> Winner (+{exp.result.lift_pct}%)
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Statistical Confidence Footer */}
              <div style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "12px", borderTop: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
                  {exp.result ? (
                    <span>Confidence: <strong style={{ color: "var(--color-text-primary, #202124)" }}>{exp.result.statistical_confidence_pct}%</strong> (p={exp.result.p_value})</span>
                  ) : (
                    <span>Collecting sample distribution...</span>
                  )}
                </div>
                {exp.status === "RUNNING" && (
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    style={{ padding: "4px 10px", fontSize: "11px" }}
                    onClick={() => handleEvaluate(exp.id)}
                    disabled={evaluatingId === exp.id}
                  >
                    {evaluatingId === exp.id ? "Testing..." : "Evaluate Stat Sig"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
