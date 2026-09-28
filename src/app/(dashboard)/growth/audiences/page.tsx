"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Filter, Plus, RefreshCw, Layers, Sparkles, CheckCircle2 } from "lucide-react";
import styles from "../growth.module.css";
import { LoadingSkeleton, EmptyState } from "@/components/ui/States/States";

/**
 * Each preset carries its own rule, in fields audience.service evaluates (FX-36 M6). They all used to create the same
 * "spend > 5,000" rule and showed made-up sizes (142 / 384 / 98); the size is computed when the segment is created.
 */
const PRESET_AUDIENCES = [
  {
    name: "VIP High Spenders",
    description: "Customers with lifetime spend over ৳5,000 and 3 or more orders",
    type: "RULE_BASED",
    conditions: [
      { field: "total_spend", operator: "GREATER_THAN", value: 5000 },
      { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 3 },
    ],
  },
  {
    name: "Dormant 60D Customers",
    description: "Buyers who have not ordered in the last 60 days",
    type: "RULE_BASED",
    conditions: [{ field: "last_purchase_days_ago", operator: "GREATER_THAN_OR_EQUAL", value: 60 }],
  },
  {
    name: "Abandoned Carts",
    description: "Customers with an abandoned cart",
    type: "RULE_BASED",
    conditions: [{ field: "has_abandoned_cart", operator: "EQUALS", value: true }],
  },
  {
    name: "At-risk Customers",
    description: "Customers whose churn risk is high",
    type: "RULE_BASED",
    conditions: [{ field: "churn_risk_level", operator: "EQUALS", value: "HIGH" }],
  },
];

export default function AudiencesPage() {
  const [audiences, setAudiences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadAudiences = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/growth/audiences");
      if (res.ok) {
        const json = await res.json();
        setAudiences(json.data.audiences || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudiences();
  }, []);

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      const res = await fetch(`/api/v1/growth/audiences/${id}/refresh`, { method: "POST" });
      if (res.ok) await loadAudiences();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleCreatePreset = async (preset: typeof PRESET_AUDIENCES[0]) => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/v1/growth/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          description: preset.description,
          type: preset.type,
          rule_groups: [{ logical_operator: "AND", conditions: preset.conditions }],
        }),
      });
      if (res.ok) {
        await loadAudiences();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Users size={26} color="var(--color-lime-primary, #C7F900)" /> Audience Segments
          </h1>
          <p className={styles.headerSubtitle}>
            Dynamic behavioral and predictive customer cohorts for targeted campaigns
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => handleCreatePreset(PRESET_AUDIENCES[0])}
            disabled={isCreating}
          >
            <Plus size={14} /> {isCreating ? "Creating..." : "New Segment"}
          </button>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/growth" className={styles.navTab}>Command Center</Link>
        <Link href="/growth/audiences" className={`${styles.navTab} ${styles.navTabActive}`}>Audiences</Link>
        <Link href="/growth/campaigns" className={styles.navTab}>Campaigns</Link>
        <Link href="/growth/journeys" className={styles.navTab}>Journeys</Link>
        <Link href="/growth/lifecycle" className={styles.navTab}>Lifecycle</Link>
        <Link href="/growth/attribution" className={styles.navTab}>Attribution</Link>
        <Link href="/growth/experiments" className={styles.navTab}>A/B Experiments</Link>
      </div>

      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : audiences.length === 0 ? (
        <div>
          <EmptyState
            title="No Audiences Defined Yet"
            description="Segment your Bangladesh commerce customer base using behavioral rules, RFM metrics, and predictive lifecycle signals."
            actionText={isCreating ? "Creating..." : "+ Quick-Create VIP Segment"}
            onAction={() => handleCreatePreset(PRESET_AUDIENCES[0])}
          />

          {/* Quick Start Presets Section */}
          <div style={{ marginTop: "32px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary, #202124)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={16} color="var(--color-lime-primary, #C7F900)" /> Recommended Starter Cohorts
            </div>

            <div className={styles.bentoGrid}>
              {PRESET_AUDIENCES.map((preset, idx) => (
                <div key={idx} className={`${styles.bentoCard} ${styles.col4}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>
                      {preset.name}
                    </div>
                    <span className={`${styles.statusPill} ${preset.type === "PREDICTIVE" ? styles.statusReview : styles.statusRunning}`}>
                      {preset.type}
                    </span>
                  </div>

                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", lineHeight: 1.5, margin: "6px 0 16px 0" }}>
                    {preset.description}
                  </p>

                  <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "12px", borderTop: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      Size is computed from your customers when created
                    </div>
                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      style={{ padding: "5px 10px", fontSize: "11px" }}
                      onClick={() => handleCreatePreset(preset)}
                      disabled={isCreating}
                    >
                      <Plus size={12} /> Activate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.bentoGrid}>
          {audiences.map((aud) => (
            <div key={aud.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>{aud.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>{aud.description}</div>
                </div>
                <span className={`${styles.statusPill} ${aud.type === "PREDICTIVE" ? styles.statusReview : styles.statusRunning}`}>
                  {aud.type}
                </span>
              </div>

              <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>Estimated Size</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                    {(aud.estimated_size || 0).toLocaleString()} <span style={{ fontSize: "12px", fontWeight: 400, color: "var(--color-text-secondary, #70736F)" }}>customers</span>
                  </div>
                </div>
                <button
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => handleRefresh(aud.id)}
                  disabled={refreshingId === aud.id}
                >
                  <RefreshCw size={12} /> {refreshingId === aud.id ? "Evaluating..." : "Refresh"}
                </button>
              </div>

              {aud.rule_groups && aud.rule_groups.length > 0 && (
                <div style={{ marginTop: "14px", padding: "10px 12px", background: "var(--color-surface-soft, #FAFBF8)", borderRadius: "8px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", fontWeight: 600, textTransform: "uppercase" }}>Rules:</div>
                  {aud.rule_groups[0]?.conditions?.map((c: any, i: number) => (
                    <div key={i} style={{ fontSize: "12px", color: "var(--color-text-primary, #202124)", marginTop: "4px" }}>
                      • {c.field} {c.operator} {String(c.value)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
