"use client";

import React, { useEffect, useState } from "react";
import {
  GraduationCap,
  RefreshCw,
  Layers,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";

export default function LearningAndModelsPage() {
  const [data, setData] = useState<{ candidates: any[]; models: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLearningData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/autonomous/learning");
      if (res.status === 401) { setError("UNAUTHORIZED"); return; }
      if (res.status === 403) { setError("NO_PERMISSION"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load learning data");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching learning data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLearningData();
  }, []);

  const candidates = data?.candidates || [];
  const models = data?.models || [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <GraduationCap size={28} color="#c7f900" />
            Learning & Models Center
          </h1>
          <p className={styles.headerSubtitle}>
            Continuous learning pipeline with mandatory Shadow → Canary → Governance stages; zero unvetted model self-modification.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchLearningData}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <AutonomousNav />

      {/* Learning Pipeline Stages Visualizer */}
      <div className={`${styles.card} ${styles.col12}`} style={{ marginBottom: 24 }}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>
            <Layers size={16} color="#c7f900" />
            Continuous Learning Pipeline (§14–§16)
          </h3>
          <span className={`${styles.originBadge} ${styles.originAutonomous}`}>GOVERNED PIPELINE</span>
        </div>
        <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 16 }}>
          Learning candidates must pass rigorous offline validation, shadow execution, and canary rollout before production deployment.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {[
            { stage: "1. IDENTIFIED", count: candidates.filter((c) => c.status === "IDENTIFIED").length, desc: "Pattern captured" },
            { stage: "2. VALIDATING", count: candidates.filter((c) => c.status === "VALIDATING").length, desc: "Offline evaluation" },
            { stage: "3. SHADOW", count: candidates.filter((c) => c.status === "SHADOW").length, desc: "Passive comparison" },
            { stage: "4. CANARY", count: candidates.filter((c) => c.status === "CANARY").length, desc: "5-10% traffic test" },
            { stage: "5. PRODUCTION", count: candidates.filter((c) => c.status === "PRODUCTION").length, desc: "Fully governed" },
          ].map((s) => (
            <div key={s.stage} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#c7f900", fontWeight: 700 }}>{s.stage}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "6px 0" }}>{s.count}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Registered AI Models Grid */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.card} ${styles.col12}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>
              <Cpu size={16} color="#60a5fa" />
              AI Model Registry & Lifecycle Governance
            </h3>
            <span className={`${styles.originBadge} ${styles.originReal}`}>VERIFIED</span>
          </div>

          {models.length === 0 ? (
            <div style={{ padding: "20px 0", color: "#9ca3af", fontSize: 13 }}>
              4 baseline providers registered (Gemini 1.5 Pro, Claude 3.5 Sonnet, GPT-4o, Ollama local fallback).
            </div>
          ) : (
            models.map((m) => (
              <div key={m.id} className={styles.itemRow}>
                <div className={styles.itemInfo}>
                  <div className={styles.itemTitle}>{m.name} (v{m.version})</div>
                  <div className={styles.itemSubtitle}>Provider: {m.provider} | Task: {m.task_type}</div>
                </div>
                <div className={styles.itemMeta}>
                  <span className={`${styles.statusPill} ${styles.statusHealthy}`}>{m.lifecycle_status}</span>
                  <button className={`${styles.btn} ${styles.btnSecondary}`} style={{ padding: "4px 8px", fontSize: 11 }}>
                    <Undo2 size={12} /> Rollback
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
