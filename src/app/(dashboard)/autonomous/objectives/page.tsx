"use client";

import React, { useEffect, useState } from "react";
import {
  Target,
  RefreshCw,
  Plus,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Layers,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";
import { BusinessObjective } from "@/types/autonomous";

export default function BusinessObjectivesPage() {
  const [objectives, setObjectives] = useState<BusinessObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [simulatingId, setSimulatingId] = useState<string | null>(null);

  const fetchObjectives = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/autonomous/objectives");
      if (res.status === 401) { setError("UNAUTHORIZED"); return; }
      if (res.status === 403) { setError("NO_PERMISSION"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load objectives");
      setObjectives(json.data.objectives || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching objectives");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchObjectives();
  }, []);

  const handleSimulate = async (objId: string) => {
    try {
      setSimulatingId(objId);
      const res = await fetch(`/api/v1/autonomous/objectives/${objId}/simulate`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        const impact = json.data?.simulation?.expected_case?.revenue_impact_bdt;
        const confidence = json.data?.simulation?.confidence;
        alert(
          `Simulation completed (simulated, not a forecast).\nExpected case: ${typeof impact === "number" ? `৳${impact.toLocaleString()}` : "not estimated"}` +
            `\nConfidence: ${typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "—"}`
        );
      } else {
        alert("Simulation failed: " + (json.error?.message || "Unknown error"));
      }
    } catch (err) {
      alert("Simulation request failed");
    } finally {
      setSimulatingId(null);
    }
  };

  const filtered = filter === "ALL" ? objectives : objectives.filter((o) => o.status === filter);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Target size={28} color="#c7f900" />
            Business Objective Center
            <span className={styles.headerBadge}>Phase 10</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Strategic business goal hierarchy with KPI progress tracking, autonomous constraint monitoring, and risk forecasting.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchObjectives}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <AutonomousNav />

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["ALL", "ACTIVE", "AT_RISK", "COMPLETED"].map((st) => (
          <button
            key={st}
            onClick={() => setFilter(st)}
            className={`${styles.btn} ${filter === st ? styles.btnPrimary : styles.btnSecondary}`}
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            {st}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.emptyState}>
          <RefreshCw className="animate-spin" size={32} color="#c7f900" />
          <p className={styles.emptyStateTitle} style={{ marginTop: 16 }}>Loading business objectives...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Target size={48} color="#9ca3af" />
          <h2 className={styles.emptyStateTitle}>No Objectives Found</h2>
          <p className={styles.emptyStateSubtitle}>No business objectives match the selected filter criteria.</p>
        </div>
      ) : (
        <div className={styles.bentoGrid}>
          {filtered.map((obj) => (
            <div key={obj.id} className={`${styles.card} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div>
                  <span className={`${styles.originBadge} ${styles.originReal}`}>{obj.hierarchy_level}</span>
                  <h3 className={styles.cardTitle} style={{ marginTop: 8 }}>{obj.name}</h3>
                </div>
                <span className={`${styles.statusPill} ${obj.status === "ACTIVE" ? styles.statusHealthy : obj.status === "AT_RISK" ? styles.statusCritical : styles.statusPending}`}>
                  {obj.status}
                </span>
              </div>

              <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 14 }}>{obj.description}</p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Target Metric</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2 }}>{obj.target_metric}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Target Value</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#c7f900", marginTop: 2 }}>
                    {obj.unit === "BDT" ? `৳${obj.target_value.toLocaleString()}` : `${obj.target_value} ${obj.unit}`}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Forecast Probability</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginTop: 2 }}>
                    {obj.forecast_achievement_percent}%
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>Progress to Target</span>
                  <strong style={{ color: "#c7f900" }}>{obj.progress_percent}%</strong>
                </div>
                <div className={styles.progressTrack}>
                  <div className={styles.progressBar} style={{ width: `${Math.min(100, obj.progress_percent)}%` }} />
                </div>
              </div>

              {/* Constraints preview */}
              {obj.constraints && obj.constraints.length > 0 && (
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
                  <strong>Constraints:</strong> {obj.constraints.map((c) => `${c.name} (${c.operator} ${c.value})`).join(", ")}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => handleSimulate(obj.id)}
                  disabled={simulatingId === obj.id}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  <Sparkles size={14} />
                  {simulatingId === obj.id ? "Simulating..." : "Simulate Strategy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
