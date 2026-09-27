"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Play,
  RefreshCw,
  Boxes,
  Truck,
  CreditCard,
  TrendingDown,
  DollarSign,
  Layers,
  Activity,
  Zap,
  Lock,
} from "lucide-react";
import styles from "./operations.module.css";
import { OperationalDigitalTwin, AutonomyBudget, ProviderStatus } from "@/types/operations";

export default function OperationsOverviewPage() {
  const [twin, setTwin] = useState<OperationalDigitalTwin | null>(null);
  const [budget, setBudget] = useState<AutonomyBudget | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningWorkflow, setRunningWorkflow] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/operations/overview");
      if (res.status === 401) {
        setError("UNAUTHORIZED");
        return;
      }
      if (res.status === 403) {
        setError("NO_PERMISSION");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load operational state");

      setTwin(json.data.twin);
      setBudget(json.data.budget);
      setProviders(json.data.providers || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const triggerWorkflow = async (workflowType: string) => {
    try {
      setRunningWorkflow(workflowType);
      const res = await fetch("/api/v1/operations/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_type: workflowType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Workflow execution failed");
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to run workflow");
    } finally {
      setRunningWorkflow(null);
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.spinner} />
          <h2 className={styles.stateTitle}>Loading Autonomous Operations Engine...</h2>
          <p className={styles.stateDescription}>
            Synchronizing Digital Twin projection across Inventory, Courier, and Payment providers.
          </p>
        </div>
      </div>
    );
  }

  // 2. Unauthorized State
  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><Lock size={24} /></div>
          <h2 className={styles.stateTitle}>Authentication Required</h2>
          <p className={styles.stateDescription}>Please sign in to access CommerceOS Autonomous Operations.</p>
        </div>
      </div>
    );
  }

  // 3. No Permission State
  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><ShieldCheck size={24} /></div>
          <h2 className={styles.stateTitle}>Access Denied</h2>
          <p className={styles.stateDescription}>You do not possess `operations.read` permission for this tenant.</p>
        </div>
      </div>
    );
  }

  // 4. Error State
  if (error || !twin) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><AlertTriangle size={24} color="#ef4444" /></div>
          <h2 className={styles.stateTitle}>Failed to Connect to Operations Engine</h2>
          <p className={styles.stateDescription}>{error || "Unknown operational error."}</p>
          <button className={styles.btnPrimary} onClick={fetchOverview}>Retry Connection</button>
        </div>
      </div>
    );
  }

  const isHalted = twin.system_mode === "EMERGENCY_HALTED" || budget?.emergency_stopped;
  const budgetPercent = budget && budget.daily_max_spend_bdt > 0
    ? Math.min(100, Math.round((budget.spend_used_today_bdt / budget.daily_max_spend_bdt) * 100))
    : 0;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Cpu size={28} color="var(--color-lime-primary, #C7F900)" />
            Autonomous Operations Engine
            <span className={styles.headerBadge}>Phase 8</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Continuous Policy-Governed Autonomous Orchestration & Digital Twin Control Plane
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchOverview} disabled={loading}>
            <RefreshCw size={14} className={loading ? styles.spinner : ""} /> Refresh Twin
          </button>
          <Link href="/operations/autonomy" className={styles.btnPrimary}>
            <ShieldCheck size={14} /> Control Center
          </Link>
        </div>
      </div>

      {/* Subnav */}
      <div className={styles.subnav}>
        <Link href="/operations" className={`${styles.tabLink} ${styles.tabLinkActive}`}>
          Overview
        </Link>
        <Link href="/operations/workflows" className={styles.tabLink}>
          Workflows
        </Link>
        <Link href="/operations/exceptions" className={styles.tabLink}>
          Exceptions
          {twin.summary_metrics.open_exceptions_count > 0 && (
            <span className={`${styles.tabBadge} ${styles.tabBadgeActive}`}>
              {twin.summary_metrics.open_exceptions_count}
            </span>
          )}
        </Link>
        <Link href="/operations/autonomy" className={styles.tabLink}>
          Autonomy & Safety
        </Link>
        <Link href="/operations/receipts" className={styles.tabLink}>
          Action Receipts
        </Link>
      </div>

      {/* Emergency Kill Switch Banner if Active */}
      {isHalted && (
        <div className={styles.emergencyHaltBanner}>
          <div className={styles.emergencyBannerText}>
            <AlertTriangle size={20} color="#ef4444" />
            <span>EMERGENCY KILL SWITCH ACTIVE: All autonomous operations are frozen across this tenant.</span>
          </div>
          <Link href="/operations/autonomy" className={styles.btnDanger}>
            Manage Halt
          </Link>
        </div>
      )}

      {/* Bento Grid Row 1: Digital Twin Hero & Budget */}
      <div className={styles.bentoGrid}>
        {/* Digital Twin Overall Score */}
        <div className={`${styles.card} ${styles.col8} ${styles.twinHeroCard}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>
              <Activity size={16} color="#c7f900" /> Operational Digital Twin Health
            </span>
            <span className={`${styles.statusBadge} ${
              twin.overall_health_score >= 85 ? styles.statusHealthy :
              twin.overall_health_score >= 65 ? styles.statusWarning : styles.statusCritical
            }`}>
              {twin.system_mode}
            </span>
          </div>

          <div className={styles.scoreDisplay}>
            <span className={styles.scoreNumber}>{twin.overall_health_score}</span>
            <span className={styles.scoreMax}>/ 100</span>
          </div>
          <p style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "13px", margin: "0 0 16px 0" }}>
            Aggregate health across inventory, couriers, payment gateways, and fulfillment SLAs.
          </p>

          <div className={styles.kpiRow}>
            <div className={styles.kpiItem}>
              <div className={styles.kpiLabel}>Stockout Risks</div>
              <div className={styles.kpiValue} style={{ color: twin.summary_metrics.inventory_items_at_risk > 0 ? "#fbbf24" : "var(--color-text-primary, #202124)" }}>
                {twin.summary_metrics.inventory_items_at_risk}
              </div>
              <div className={styles.kpiSub}>SKUs &lt; safety threshold</div>
            </div>

            <div className={styles.kpiItem}>
              <div className={styles.kpiLabel}>Shipment Delays</div>
              <div className={styles.kpiValue} style={{ color: twin.summary_metrics.shipment_delay_count > 0 ? "#f87171" : "var(--color-text-primary, #202124)" }}>
                {twin.summary_metrics.shipment_delay_count}
              </div>
              <div className={styles.kpiSub}>In transit &gt; 36 hours</div>
            </div>

            <div className={styles.kpiItem}>
              <div className={styles.kpiLabel}>Unreconciled BDT</div>
              <div className={styles.kpiValue}>
                ৳{twin.summary_metrics.unreconciled_payments_bdt.toLocaleString()}
              </div>
              <div className={styles.kpiSub}>Payment variances</div>
            </div>

            <div className={styles.kpiItem}>
              <div className={styles.kpiLabel}>Open Exceptions</div>
              <div className={styles.kpiValue} style={{ color: twin.summary_metrics.open_exceptions_count > 0 ? "#fbbf24" : "#047857" }}>
                {twin.summary_metrics.open_exceptions_count}
              </div>
              <div className={styles.kpiSub}>Across all domains</div>
            </div>
          </div>
        </div>

        {/* Autonomy Budget Utilization */}
        <div className={`${styles.card} ${styles.col4}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>
              <Zap size={16} color="var(--color-lime-primary, #C7F900)" /> Autonomy Spend Budget
            </span>
            <span className={styles.tabBadge}>Daily Quota</span>
          </div>

          <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
              <span>Daily Spend Used</span>
              <span style={{ fontWeight: "700", color: "var(--color-text-primary, #202124)" }}>
                ৳{budget?.spend_used_today_bdt.toLocaleString()} / ৳{budget?.daily_max_spend_bdt.toLocaleString()}
              </span>
            </div>
            <div className={styles.progressBarBg}>
              <div
                className={`${styles.progressBarFill} ${budgetPercent > 85 ? styles.progressBarFillDanger : budgetPercent > 60 ? styles.progressBarFillWarning : ""}`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
          </div>

          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
              <span>Actions Executed</span>
              <span style={{ fontWeight: "700", color: "var(--color-text-primary, #202124)" }}>
                {budget?.actions_used_today} / {budget?.daily_max_actions}
              </span>
            </div>
            <div className={styles.progressBarBg}>
              <div
                className={styles.progressBarFill}
                style={{
                  width: `${budget && budget.daily_max_actions > 0 ? Math.min(100, (budget.actions_used_today / budget.daily_max_actions) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: "24px" }}>
            <span className={styles.cardTitle} style={{ fontSize: "12px", marginBottom: "8px" }}>
              Provider Circuits
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {Object.entries(providers).map(([pName, pStatus]) => (
                <span
                  key={pName}
                  className={`${styles.statusBadge} ${
                    pStatus === "HEALTHY" ? styles.statusHealthy :
                    pStatus === "DEGRADED" ? styles.statusWarning : styles.statusCritical
                  }`}
                  style={{ fontSize: "10px", padding: "2px 8px" }}
                >
                  {pName}: {pStatus}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid Row 2: 10 Operational Domains */}
      <div className={styles.card} style={{ marginBottom: "24px" }}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>
            <Layers size={16} color="var(--color-lime-primary, #C7F900)" /> Operational Domain Projections (Digital Twin)
          </span>
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>Authoritative Read-Model Projection</span>
        </div>

        <div className={styles.domainGrid}>
          {Object.entries(twin.domains).map(([key, dom]) => (
            <div key={key} className={styles.domainCard}>
              <div className={styles.domainHeader}>
                <span className={styles.domainName}>{dom.domain}</span>
                <span className={`${styles.statusBadge} ${
                  dom.status === "HEALTHY" ? styles.statusHealthy :
                  dom.status === "ATTENTION_REQUIRED" ? styles.statusWarning : styles.statusCritical
                }`}>
                  {dom.status === "ATTENTION_REQUIRED" ? "WARN" : dom.status}
                </span>
              </div>
              <div className={styles.domainMeta}>
                <span>Exceptions: <strong>{dom.open_exceptions_count}</strong></span>
                <span>Tasks: <strong>{dom.active_tasks_count}</strong></span>
              </div>
              <div className={styles.domainMeta}>
                <span>SLA: <strong>{dom.sla_compliance_percent}%</strong></span>
              </div>
              {dom.last_automated_action && (
                <div style={{ fontSize: "10px", color: "var(--color-text-secondary, #70736F)", marginTop: "8px", fontStyle: "italic" }}>
                  {dom.last_automated_action}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bento Grid Row 3: Autonomous Workflow Dispatcher */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>
            <Play size={16} color="var(--color-lime-primary, #C7F900)" /> Quick Autonomous Operations Dispatch
          </span>
          <Link href="/operations/workflows" style={{ fontSize: "12px", color: "var(--color-text-primary, #202124)", textDecoration: "underline", fontWeight: 600 }}>
            View Workflow Stepper &rarr;
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginTop: "12px" }}>
          <div className={styles.domainCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <Boxes size={18} color="var(--color-lime-primary, #C7F900)" />
              <strong style={{ fontSize: "13px" }}>Low Stock Replenishment</strong>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", margin: "0 0 12px 0" }}>
              Forecasts stockouts and drafts MOQ-validated Purchase Orders to preferred suppliers.
            </p>
            <button
              className={styles.btnPrimary}
              onClick={() => triggerWorkflow("LOW_STOCK_REPLENISHMENT")}
              disabled={Boolean(runningWorkflow) || isHalted}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {runningWorkflow === "LOW_STOCK_REPLENISHMENT" ? "Executing..." : "Run Replenishment"}
            </button>
          </div>

          <div className={styles.domainCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <Truck size={18} color="var(--color-lime-primary, #C7F900)" />
              <strong style={{ fontSize: "13px" }}>Courier Failover Recovery</strong>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", margin: "0 0 12px 0" }}>
              Identifies parcels stuck in transit (&gt;36h) and fails over to healthy alternate carriers.
            </p>
            <button
              className={styles.btnPrimary}
              onClick={() => triggerWorkflow("DELAYED_SHIPMENT_FAILOVER")}
              disabled={Boolean(runningWorkflow) || isHalted}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {runningWorkflow === "DELAYED_SHIPMENT_FAILOVER" ? "Executing..." : "Run Shipment Audit"}
            </button>
          </div>

          <div className={styles.domainCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <CreditCard size={18} color="var(--color-lime-primary, #C7F900)" />
              <strong style={{ fontSize: "13px" }}>Payment Variance Audit</strong>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", margin: "0 0 12px 0" }}>
              Scans MFS gateway transactions and flags timeouts or unverified TrxIDs.
            </p>
            <button
              className={styles.btnPrimary}
              onClick={() => triggerWorkflow("PAYMENT_FAILURE_RECOVERY")}
              disabled={Boolean(runningWorkflow) || isHalted}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {runningWorkflow === "PAYMENT_FAILURE_RECOVERY" ? "Executing..." : "Audit Payments"}
            </button>
          </div>

          <div className={styles.domainCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <DollarSign size={18} color="var(--color-lime-primary, #C7F900)" />
              <strong style={{ fontSize: "13px" }}>Daily Financial Brief</strong>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", margin: "0 0 12px 0" }}>
              Deterministic revenue reconciliation matching delivered orders against COD receipts.
            </p>
            <button
              className={styles.btnPrimary}
              onClick={() => triggerWorkflow("DAILY_OPERATIONAL_BRIEF")}
              disabled={Boolean(runningWorkflow) || isHalted}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {runningWorkflow === "DAILY_OPERATIONAL_BRIEF" ? "Executing..." : "Generate Brief"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
