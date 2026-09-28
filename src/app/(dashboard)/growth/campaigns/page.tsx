"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Send, Play, Pause, CheckCircle2, AlertCircle, RefreshCw, BarChart2 } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton, EmptyState } from "@/components/ui/States/States";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/growth/campaigns");
      if (res.ok) {
        const json = await res.json();
        setCampaigns(json.data.campaigns || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const handleAction = async (id: string, action: "execute" | "approve" | "pause" | "resume" | "simulate") => {
    setActionId(id);
    try {
      const res = await fetch(`/api/v1/growth/campaigns/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        alert(`Action failed: ${errJson.error?.message || "Server error"}`);
      }
      await loadCampaigns();
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Send size={26} color="var(--color-lime-primary, #C7F900)" /> Campaigns Cockpit
          </h1>
          <p className={styles.headerSubtitle}>
            Plan, govern, simulate, and execute multi-channel growth campaigns
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={styles.navTab}>Audiences</Link>
        <Link href="/growth/campaigns" className={`${styles.navTab} ${styles.navTabActive}`}>Campaigns</Link>
        <Link href="/growth/journeys" className={styles.navTab}>Journeys</Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>Lifecycle</Link>
        <Link href="/growth/attribution" className={styles.navTab}>Attribution</Link>
        <Link href="/growth/experiments" className={styles.navTab}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={5} />
      ) : campaigns.length === 0 ? (
        <EmptyState title="No Campaigns Found" description="Start by planning your first automated growth campaign." />
      ) : (
        <div className={styles.bentoGrid}>
          {campaigns.map((cmp) => (
            <div key={cmp.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>{cmp.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                    Channel: <strong style={{ color: "var(--color-text-primary)" }}>{cmp.channel}</strong> • Goal: {cmp.objective}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <span className={`${styles.statusPill} ${cmp.status === "RUNNING" ? styles.statusRunning : cmp.status === "REVIEW" ? styles.statusReview : styles.statusDraft}`}>
                    {cmp.status}
                  </span>
                  <span className={`${styles.statusPill} ${cmp.risk_class === "HIGH" ? styles.badgeDanger : styles.badgePositive}`}>
                    {cmp.risk_class} RISK
                  </span>
                </div>
              </div>

              {/* Simulation metrics if present */}
              {cmp.simulation_snapshot && (
                <div style={{ margin: "12px 0", padding: "10px 14px", background: "var(--color-surface-soft, #FAFBF8)", borderRadius: "8px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-primary)", fontWeight: 700, letterSpacing: "0.02em" }}>SIMULATED — assumptions, not a forecast</div>
                  <div style={{ display: "flex", gap: "16px", marginTop: "6px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    <span>
                      Revenue:{" "}
                      <strong style={{ color: "var(--color-text-primary)" }}>
                        {typeof cmp.simulation_snapshot.expected_revenue_bdt === "number"
                          ? `৳${cmp.simulation_snapshot.expected_revenue_bdt.toLocaleString()}`
                          : "not estimated"}
                      </strong>
                    </span>
                    <span>Orders: <strong style={{ color: "var(--color-text-primary)" }}>{cmp.simulation_snapshot.expected_orders ?? "—"}</strong></span>
                    <span>Reach: <strong style={{ color: "var(--color-text-primary)" }}>{cmp.simulation_snapshot.estimated_reach ?? "—"}</strong></span>
                  </div>
                  {Array.isArray(cmp.simulation_snapshot.assumptions) && (
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                      {cmp.simulation_snapshot.assumptions.join(" ")}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ marginTop: "14px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {cmp.status === "REVIEW" && (
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={actionId === cmp.id}
                    onClick={() => handleAction(cmp.id, "approve")}
                  >
                    <CheckCircle2 size={12} /> Approve Campaign
                  </button>
                )}
                {(cmp.status === "APPROVED" || cmp.status === "SCHEDULED") && (
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={actionId === cmp.id}
                    onClick={() => handleAction(cmp.id, "execute")}
                  >
                    <Play size={12} /> Execute Now
                  </button>
                )}
                {cmp.status === "RUNNING" && (
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    disabled={actionId === cmp.id}
                    onClick={() => handleAction(cmp.id, "pause")}
                  >
                    <Pause size={12} /> Pause
                  </button>
                )}
                {cmp.status === "PAUSED" && (
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    disabled={actionId === cmp.id}
                    onClick={() => handleAction(cmp.id, "resume")}
                  >
                    <Play size={12} /> Resume
                  </button>
                )}
                <button
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  disabled={actionId === cmp.id}
                  onClick={() => handleAction(cmp.id, "simulate")}
                >
                  <BarChart2 size={12} /> Re-Simulate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
