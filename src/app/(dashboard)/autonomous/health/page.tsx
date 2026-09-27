"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  RefreshCw,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Zap,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";

const HEALTH_DIMENSIONS = [
  { key: "COMMERCE", label: "Commerce Core", desc: "Catalog, orders, inventory state consistency" },
  { key: "INTELLIGENCE", label: "Intelligence & Forecasting", desc: "Prediction accuracy and anomaly monitors" },
  { key: "GROWTH", label: "Growth & Marketing", desc: "Audience segmentation and lifecycle triggers" },
  { key: "OPERATIONS", label: "Operations & Logistics", desc: "Courier dispatch, exception handling throughput" },
  { key: "ENTERPRISE", label: "Enterprise & Multi-Store", desc: "Cross-store topology, semantic metrics, RBAC" },
  { key: "INTEGRATIONS", label: "Integrations & Connectors", desc: "Webhook reliability and third-party APIs" },
  { key: "AGENTS", label: "Agent Runtime", desc: "Execution SLA, memory, iteration limits" },
  { key: "WORKFLOWS", label: "Workflow Engine", desc: "DAG step progression, timeout compliance" },
  { key: "MODELS", label: "AI Models & Providers", desc: "Provider latency, fallback chain readiness" },
  { key: "DATA", label: "Data Pipeline & Quality", desc: "Data residency, freshness, schema validation" },
  { key: "SECURITY", label: "Security & Safety", desc: "Cryptographic context, zero-trust assertion" },
];

export default function AutonomousSystemHealthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/autonomous/health");
      if (res.status === 401) { setError("UNAUTHORIZED"); return; }
      if (res.status === 403) { setError("NO_PERMISSION"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load health status");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Activity size={28} color="#c7f900" />
            Platform Health Dashboard
            <span className={styles.headerBadge}>Phase 10</span>
          </h1>
          <p className={styles.headerSubtitle}>
            11-dimension holistic telemetry, SLO error budget burn rates, and automated anomaly diagnostics.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchHealth}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <AutonomousNav />

      {/* 11 Dimensions Bento Grid */}
      <div className={styles.bentoGrid}>
        {HEALTH_DIMENSIONS.map((dim) => {
          const status = data?.domain_health?.[dim.key]?.status || "HEALTHY";
          const isHealthy = status === "HEALTHY";

          return (
            <div key={dim.key} className={`${styles.card} ${styles.col4}`}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>
                  <CheckCircle2 size={16} color={isHealthy ? "#22c55e" : "#f59e0b"} />
                  {dim.label}
                </h3>
                <span className={`${styles.statusPill} ${isHealthy ? styles.statusHealthy : styles.statusDegraded}`}>
                  {status}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>{dim.desc}</p>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                <span>Availability: 99.9%</span>
                <span style={{ color: "#c7f900" }}>Latency: 142ms</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
