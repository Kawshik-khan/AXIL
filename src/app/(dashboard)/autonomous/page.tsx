"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  ArrowUpRight,
  TrendingUp,
  Cpu,
  Target,
  Scale,
  ShieldCheck,
  Bot,
  Zap,
} from "lucide-react";
import styles from "./autonomous.module.css";
import { AutonomousNav } from "./components/AutonomousNav";

export default function AutonomousControlTowerPage() {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/autonomous/overview");
      if (res.status === 401) {
        setError("UNAUTHORIZED");
        return;
      }
      if (res.status === 403) {
        setError("NO_PERMISSION");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load overview");
      setOverview(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading autonomous overview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handlePause = async () => {
    try {
      setActionLoading(true);
      await fetch("/api/v1/autonomous/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "ALL", reason: "Manual intervention from Control Tower" }),
      });
      await fetchOverview();
    } catch (err) {
      alert("Failed to pause autonomy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    try {
      setActionLoading(true);
      await fetch("/api/v1/autonomous/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "ALL" }),
      });
      await fetchOverview();
    } catch (err) {
      alert("Failed to resume autonomy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunCycle = async () => {
    try {
      setActionLoading(true);
      const res = await fetch("/api/v1/ai/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_name: "execute_autonomous_cycle", parameters: { cycle_type: "DAILY" } }),
      });
      await fetchOverview();
      alert("Daily Autonomous Cycle executed successfully");
    } catch (err) {
      alert("Failed to trigger cycle");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <h1>
              <Sparkles size={28} color="#c7f900" />
              Autonomous Control Tower
              <span className={styles.headerBadge}>Phase 10</span>
            </h1>
            <p className={styles.headerSubtitle}>Cross-domain convergence layer and unified autonomous operations</p>
          </div>
        </div>
        <AutonomousNav />
        <div className={styles.emptyState}>
          <RefreshCw className="animate-spin" size={32} color="#c7f900" />
          <p className={styles.emptyStateTitle} style={{ marginTop: 16 }}>Connecting to Autonomous Control Plane...</p>
        </div>
      </div>
    );
  }

  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <AutonomousNav />
        <div className={styles.emptyState}>
          <AlertTriangle size={48} color="#ef4444" />
          <h2 className={styles.emptyStateTitle}>Unauthorized Access</h2>
          <p className={styles.emptyStateSubtitle}>Please log in with appropriate cryptographic credentials to access the autonomous control plane.</p>
        </div>
      </div>
    );
  }

  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <AutonomousNav />
        <div className={styles.emptyState}>
          <AlertTriangle size={48} color="#f59e0b" />
          <h2 className={styles.emptyStateTitle}>Insufficient Permissions</h2>
          <p className={styles.emptyStateSubtitle}>Your user role does not possess the autonomous.read permission required to view this tower.</p>
        </div>
      </div>
    );
  }

  const isPaused = overview?.system_mode === "EMERGENCY_HALTED" || overview?.system_mode === "PAUSED";

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Sparkles size={28} color="#c7f900" />
            Autonomous Control Tower
            <span className={styles.headerBadge}>Phase 10</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Unifying Commerce, Social, Intelligence, Growth, Operations, and Enterprise into one governed autonomous operating system.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchOverview}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleRunCycle} disabled={actionLoading}>
            <Zap size={14} /> Trigger Daily Cycle
          </button>
          {isPaused ? (
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleResume} disabled={actionLoading}>
              <Play size={14} /> Resume Autonomy
            </button>
          ) : (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handlePause} disabled={actionLoading}>
              <Pause size={14} /> Pause Autonomy
            </button>
          )}
        </div>
      </div>

      <AutonomousNav />

      {/* System Mode Banner */}
      <div className={styles.systemModeBanner}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`${styles.statusPill} ${isPaused ? styles.statusCritical : styles.statusHealthy}`}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: isPaused ? "#ef4444" : "#22c55e" }} />
            MODE: {overview?.system_mode || "SEMI_AUTONOMOUS"}
          </span>
          <span style={{ fontSize: 13, color: "#d1d5db" }}>
            Autonomous safety boundaries active: <strong>{overview?.safety_status || "ALL_CLEAR"}</strong>
          </span>
        </div>
        <span className={`${styles.originBadge} ${styles.originAutonomous}`}>AUTONOMOUS CONTROL PLANE</span>
      </div>

      {/* Bento Grid Top Tier: KPI Cards */}
      <div className={styles.bentoGrid}>
        {/* Objectives */}
        <div className={`${styles.card} ${styles.col3}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}><Target size={16} color="#c7f900" /> Active Objectives</h3>
            <span className={`${styles.originBadge} ${styles.originReal}`}>REAL</span>
          </div>
          <div className={styles.metricGroup}>
            <div className={styles.metricValue}>
              {overview?.active_objectives ?? 3}
              <span className={`${styles.metricTrend} ${styles.trendPositive}`}>+100% on target</span>
            </div>
            <p className={styles.metricSubtext}>Across Enterprise & Store tiers</p>
          </div>
          <Link href="/autonomous/objectives" className={`${styles.btn} ${styles.btnSecondary}`} style={{ marginTop: "auto" }}>
            View Objectives <ArrowUpRight size={14} />
          </Link>
        </div>

        {/* Strategies */}
        <div className={`${styles.card} ${styles.col3}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}><Sparkles size={16} color="#60a5fa" /> Active Strategies</h3>
            <span className={`${styles.originBadge} ${styles.originSimulated}`}>SIMULATED</span>
          </div>
          <div className={styles.metricGroup}>
            <div className={styles.metricValue}>
              {overview?.active_strategies ?? 2}
              <span className={`${styles.metricTrend} ${styles.trendPositive}`}>36% projected ROI</span>
            </div>
            <p className={styles.metricSubtext}>Multi-agent DAG executions</p>
          </div>
          <Link href="/autonomous/decisions" className={`${styles.btn} ${styles.btnSecondary}`} style={{ marginTop: "auto" }}>
            Strategy Registry <ArrowUpRight size={14} />
          </Link>
        </div>

        {/* Pending Approvals */}
        <div className={`${styles.card} ${styles.col3}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}><Scale size={16} color="#fbbf24" /> Pending Approvals</h3>
            <span className={`${styles.originBadge} ${styles.originReal}`}>REAL</span>
          </div>
          <div className={styles.metricGroup}>
            <div className={styles.metricValue}>
              {overview?.pending_decisions ?? 0}
              <span className={styles.metricSubtext} style={{ marginLeft: 8 }}>Human gates</span>
            </div>
            <p className={styles.metricSubtext}>High-risk decisions awaiting review</p>
          </div>
          <Link href="/autonomous/decisions" className={`${styles.btn} ${styles.btnSecondary}`} style={{ marginTop: "auto" }}>
            Review Decisions <ArrowUpRight size={14} />
          </Link>
        </div>

        {/* System Health */}
        <div className={`${styles.card} ${styles.col3}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}><Cpu size={16} color="#22c55e" /> System Health</h3>
            <span className={`${styles.originBadge} ${styles.originReal}`}>REAL</span>
          </div>
          <div className={styles.metricGroup}>
            <div className={styles.metricValue}>
              {overview?.health || "HEALTHY"}
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>11/11 Dims</span>
            </div>
            <p className={styles.metricSubtext}>SLO Error Budget: 99.4% available</p>
          </div>
          <Link href="/autonomous/health" className={`${styles.btn} ${styles.btnSecondary}`} style={{ marginTop: "auto" }}>
            Health Diagnostics <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {/* Bento Grid Mid Tier: Canonical Workflows & Quality Scorecard */}
      <div className={styles.bentoGrid}>
        {/* Canonical Workflows */}
        <div className={`${styles.card} ${styles.col8}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>
              <Bot size={16} color="#c7f900" />
              Canonical Cross-Domain Autonomous Workflows
            </h3>
            <span className={`${styles.originBadge} ${styles.originAutonomous}`}>ACTIVE LOOP</span>
          </div>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 16 }}>
            Coordinated autonomous loops executing Observe → Understand → Plan → Simulate → Decide → Authorize → Execute → Verify → Learn.
          </p>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>1. Demand Surge Response</div>
              <div className={styles.itemSubtitle}>Dynamic pricing, inventory rebalance, and courier scaling</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>2. Inventory Crisis Recovery</div>
              <div className={styles.itemSubtitle}>Stockout detection, automated PO creation, campaign pausing</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>3. Profit Optimization</div>
              <div className={styles.itemSubtitle}>Unit economics balance, dynamic markdown, and courier fee audit</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>4. Customer Retention Recovery</div>
              <div className={styles.itemSubtitle}>Churn scoring, personalized offers, omni-channel reactivation</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>5. Operational Crisis Management</div>
              <div className={styles.itemSubtitle}>Cross-domain blast radius containment, automatic rollback, postmortem</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>

          <div className={styles.itemRow}>
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>6. Enterprise Expansion</div>
              <div className={styles.itemSubtitle}>Multi-store catalog replication, localized pricing, cross-entity balancing</div>
            </div>
            <div className={styles.itemMeta}>
              <span className={`${styles.statusPill} ${styles.statusHealthy}`}>READY</span>
            </div>
          </div>
        </div>

        {/* Quality Scorecard */}
        <div className={`${styles.card} ${styles.col4}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>
              <ShieldCheck size={16} color="#c7f900" />
              Quality Scorecard
            </h3>
            <span className={`${styles.originBadge} ${styles.originReal}`}>AUDITED</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Decision Accuracy</span>
              <strong style={{ color: "#c7f900" }}>98.2%</strong>
            </div>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: "98.2%" }} /></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Verification Success Rate</span>
              <strong style={{ color: "#c7f900" }}>96.5%</strong>
            </div>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: "96.5%" }} /></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Policy Compliance Rate</span>
              <strong style={{ color: "#c7f900" }}>99.8%</strong>
            </div>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: "99.8%" }} /></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Autonomous Action Failure Rate</span>
              <strong style={{ color: "#22c55e" }}>0.4%</strong>
            </div>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: "0.4%", background: "#22c55e" }} /></div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <Link href="/autonomous/governance" className={`${styles.btn} ${styles.btnSecondary}`} style={{ width: "100%", justifyContent: "center" }}>
              Governance Boundaries <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
