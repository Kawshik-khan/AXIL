"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GitFork, Play, Pause, ArrowRight, CheckCircle } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton, EmptyState } from "@/components/ui/States/States";

export default function JourneysPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJourneys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/growth/journeys");
      if (res.ok) {
        const json = await res.json();
        setJourneys(json.data.journeys || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJourneys();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <GitFork size={26} color="var(--color-lime-primary, #C7F900)" /> Customer Journeys
          </h1>
          <p className={styles.headerSubtitle}>
            Durable multi-node automated workflows with delays, conditions, and branch splits
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={styles.navTab}>Audiences</Link>
        <Link href="/growth/campaigns" className={styles.navTab}>Campaigns</Link>
        <Link href="/growth/journeys" className={`${styles.navTab} ${styles.navTabActive}`}>Journeys</Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>Lifecycle</Link>
        <Link href="/growth/attribution" className={styles.navTab}>Attribution</Link>
        <Link href="/growth/experiments" className={styles.navTab}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : journeys.length === 0 ? (
        <EmptyState title="No Journeys Found" description="Build automated customer journeys to nurture leads and re-engage dormant buyers." />
      ) : (
        <div className={styles.bentoGrid}>
          {journeys.map((j) => (
            <div key={j.id} className={`${styles.bentoCard} ${styles.col12}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>{j.name}</div>
                  <div style={{ fontSize: "13px", color: "var(--color-text-secondary, #70736F)", marginTop: "3px" }}>
                    Trigger: <strong style={{ color: "var(--color-text-primary, #202124)" }}>{j.trigger_event}</strong> • Enrolled: {j.enrolled_count || 0} • Completed: {j.completed_count || 0}
                  </div>
                </div>
                <span className={`${styles.statusPill} ${j.status === "ACTIVE" ? styles.statusRunning : styles.statusDraft}`}>
                  {j.status}
                </span>
              </div>

              {/* Visual Journey Steps Pipeline */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", overflowX: "auto", padding: "12px 0" }}>
                {(j.steps || []).map((step: any, idx: number) => (
                  <React.Fragment key={step.id}>
                    <div style={{ background: "var(--color-surface-soft, #FAFBF8)", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.08))", padding: "12px 16px", borderRadius: "10px", minWidth: "150px" }}>
                      <div style={{ fontSize: "10px", color: "var(--color-text-secondary, #70736F)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{step.type}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #202124)", marginTop: "3px" }}>{step.title}</div>
                    </div>
                    {idx < j.steps.length - 1 && <ArrowRight size={16} color="var(--color-text-secondary, #70736F)" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
